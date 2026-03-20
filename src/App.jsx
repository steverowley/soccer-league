import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, RotateCcw, Settings } from "lucide-react";
import TEAMS from "./teams.js";
import { AgentSystem, CosmicArchitect, COMMENTATOR_PROFILES } from "./agents.js";
import {
  createAgent, createAIManager,
  getActive, teamStats, getPlayer, formBonus,
  makeSub, calcMVP, resolveContest, buildCommentary,
  genFreekickSeq, genCelebrationSeq, genVARSeq, genSiegeSeq,
  genManagerSentOffSeq, genComebackSeq, genCounterSeq,
  genConfrontationSeq, genNearMissSeq, genPenaltySeq,
  genEvent, genSocial,
} from "./gameEngine.js";

import {
  C, bdr, PERS, PERS_ICON, WX, WX_ICON, PLANET_WX,
  MGER_EMO, EMO_ICON, REFS, STADIUMS, POS_ORDER,
} from "./constants.js";
import { rnd, rndI, pick } from "./utils.js";
import { Stat, PlayerRow, FeedCard, AgentCard, ArchitectCard, ApiKeyModal, BetBtn, PlayerCard } from "./components/MatchComponents.jsx";
import { calcChaosLevel, flattenSequences, buildPostGoalExtras, applyLateGameLogic } from "./simulateHelpers.js";

// ── Halftime tunnel quotes ─────────────────────────────────────────────────────
// Two quote buckets selected by scoreline when the whistle blows at 45':
//   TUNNEL_Q[0]  adversity / trailing — urges fight and adjustment.
//   TUNNEL_Q[1]  confidence / leading or level — urges patience and execution.
//
// Defined at module level so the simulateMinute setState callback never
// reallocates this array on every tick (it would otherwise be re-created
// every time the interval fires, ~1–5 times per second).
const TUNNEL_Q = [
  [
    'We need more desire out there. Leave everything on that pitch.',
    "The numbers don\u2019t lie. Adjust and execute.",
    "I\u2019ve seen worse. Fix the shape.",
  ],
  [
    "Tactically we\u2019re sound. Just need that final ball.",
    'Patience. The goal is coming.',
    "Keep the faith. We\u2019ve been here before.",
  ],
];

// ── Betting helpers ────────────────────────────────────────────────────────────
// Pure functions with no component state; defined at module level so React
// never re-creates them on re-render (they were previously inside the component
// body, causing a fresh allocation on every state update).

/**
 * Returns a human-readable label for a bet type.
 *
 * @param {string} type - Bet type key (e.g. 'homeWin', 'score_2_1').
 * @param {{ homeTeam: {shortName:string}, awayTeam: {shortName:string} }} ms
 * @returns {string}
 */
const betLabel = (type, ms) => {
  if (type === 'homeWin') return ms.homeTeam.shortName + ' Win';
  if (type === 'awayWin') return ms.awayTeam.shortName + ' Win';
  if (type === 'draw')    return 'Draw';
  if (type === 'over25')  return 'Over 2.5 Goals';
  if (type === 'under25') return 'Under 2.5 Goals';
  if (type === 'redCard') return 'Red Card Shown';
  if (type === 'btts')    return 'Both Teams Score';
  if (type === 'nobtts')  return 'Clean Sheet (1 team)';
  if (type && type.startsWith('score_'))  return 'Exact Score '  + type.replace('score_',  '').replace('_', '-');
  if (type && type.startsWith('scorer_')) return 'First Scorer: ' + type.replace('scorer_', '');
  return type;
};

/**
 * Returns the live settlement status of a placed bet given the current match state.
 *
 * @param {{ type: string, amount: number, odds: number }} bet
 * @param {{ score: number[], minute: number, redCards: {home:number,away:number},
 *            events: object[] }} ms
 * @returns {'winning'|'losing'|'pending'}
 */
const betStatus = (bet, ms) => {
  const [h, a] = ms.score;
  const total   = h + a;
  const hadRed  = ms.redCards.home > 0 || ms.redCards.away > 0;
  if (bet.type === 'homeWin')  return h > a ? 'winning' : h < a ? 'losing' : 'pending';
  if (bet.type === 'awayWin')  return a > h ? 'winning' : a < h ? 'losing' : 'pending';
  if (bet.type === 'draw')     return h === a ? 'winning' : 'losing';
  if (bet.type === 'over25')   return total >= 3 ? 'winning' : total < 3 && ms.minute > 85 ? 'losing' : 'pending';
  if (bet.type === 'under25')  return total < 3 ? 'winning' : total >= 3 ? 'losing' : 'pending';
  if (bet.type === 'redCard')  return hadRed ? 'winning' : ms.minute > 85 ? 'losing' : 'pending';
  if (bet.type === 'btts')     return (h > 0 && a > 0) ? 'winning' : ms.minute > 85 ? 'losing' : 'pending';
  if (bet.type === 'nobtts')   return (h === 0 || a === 0) ? 'winning' : (h > 0 && a > 0) ? 'losing' : 'pending';
  if (bet.type && bet.type.startsWith('score_')) {
    const [sh, sa] = bet.type.replace('score_', '').split('_').map(Number);
    return (h === sh && a === sa) ? 'winning' : ms.minute > 85 ? 'losing' : 'pending';
  }
  if (bet.type && bet.type.startsWith('scorer_')) {
    const name      = bet.type.replace('scorer_', '');
    const firstGoal = ms.events.find(e => e.isGoal);
    return firstGoal ? (firstGoal.player === name ? 'winning' : 'losing') : 'pending';
  }
  return 'pending';
};

/**
 * Calculates pre-match win/draw/loss odds from team attacking+technical stats.
 *
 * The 0.65 factor caps the win-probability sum so the remaining ~35% is shared
 * by draws, preventing impossibly tight odds.  The 0.88 vigorish factor bakes
 * the bookmaker margin into the returned decimal odds.
 *
 * @param {{ players: object[] }} homeTeam
 * @param {{ players: object[] }} awayTeam
 * @param {{ home: string[], away: string[] }} activePlayers
 * @returns {{ homeWin: string, draw: string, awayWin: string }}
 */
const getOdds = (homeTeam, awayTeam, activePlayers) => {
  const hStats = teamStats(homeTeam, activePlayers.home);
  const aStats = teamStats(awayTeam,  activePlayers.away);
  const hStr   = (hStats.attacking + hStats.technical) / 2;
  const aStr   = (aStats.attacking + aStats.technical) / 2;
  const total  = hStr + aStr;
  // 0.65 — combined win probability cap, leaving ~35% for draw probability
  const hWinProb  = hStr / total * 0.65;
  const aWinProb  = aStr / total * 0.65;
  const drawProb  = 1 - hWinProb - aWinProb;
  // 0.88 — vigorish (bookmaker margin) applied to all three markets
  return {
    homeWin: Math.max(1.2, (1 / hWinProb * 0.88)).toFixed(2),
    draw:    Math.max(1.5, (1 / drawProb  * 0.88)).toFixed(2),
    awayWin: Math.max(1.2, (1 / aWinProb  * 0.88)).toFixed(2),
  };
};

/**
 * Returns the bookmaker's odds for an exact final scoreline.
 *
 * Common scorelines (e.g. 1-0, 1-1) carry tighter odds; rare ones default to 15.
 *
 * @param {number} h - Home goals
 * @param {number} a - Away goals
 * @returns {number} Decimal odds
 */
const getScoreOdds = (h, a) => {
  const base = {
    score_0_0: 8,  score_1_0: 4.5, score_0_1: 4.5, score_1_1: 3.5,
    score_2_0: 7,  score_0_2: 7,   score_2_1: 6,   score_1_2: 6,
    score_2_2: 10, score_3_0: 14,  score_0_3: 14,  score_3_1: 12, score_1_3: 12,
  };
  return base[`score_${h}_${a}`] || 15; // 15 — default for unlisted/unlikely scorelines
};

/**
 * Returns the first-scorer odds for a given player based on their attacking stat.
 *
 * Higher attacking → lower odds (more likely to score first).
 * Capped at 2.5 to prevent trivially tight odds for elite attackers.
 *
 * @param {{ attacking: number }} player
 * @returns {string} Decimal odds string (1 d.p.)
 */
const getScorerOdds = (player) => {
  const base = player.attacking || 70; // 70 — fallback if attacking stat is missing
  return Math.max(2.5, (120 - base) / 10).toFixed(1);
};

const MatchSimulator = ({
  homeTeamKey = 'mars',
  awayTeamKey = 'saturn',
  compact = false,
  autoStart = false,
  startDelay = 500,
  onExpand = null,
} = {}) => {
  const initState=()=>({
    minute:0,score:[0,0],possession:[50,50],momentum:[0,0],
    events:[],isPlaying:false,
    homeTeam:TEAMS[homeTeamKey]||TEAMS.mars,awayTeam:TEAMS[awayTeamKey]||TEAMS.saturn,
    currentAnimation:null,isPaused:false,pauseCommentary:null,
    playerStats:{},mvp:null,stoppageTime:0,inStoppageTime:false,
    redCards:{home:0,away:0},
    activePlayers:{home:TEAMS.mars.players.filter(p=>p.starter).map(p=>p.name),away:TEAMS.saturn.players.filter(p=>p.starter).map(p=>p.name)},
    substitutionsUsed:{home:0,away:0},
    aiThoughts:[],socialFeed:[],lastEventType:null,
    managerSentOff:{home:false,away:false},
  });
  const [matchState,setMatchState]=useState(initState());
  const [speed,setSpeed]=useState(1000);
  const [aiManager,setAiManager]=useState(null);
  const aiRef=useRef(null);
  const intervalRef=useRef(null);
  const evtLogRef=useRef(null);
  const [showBetting,setShowBetting]=useState(true);
  const [credits,setCredits]=useState(1000);
  const [currentBets,setCurrentBets]=useState([]);
  const [betAmount,setBetAmount]=useState(100);
  const [betResult,setBetResult]=useState(null);
  const [betToast,setBetToast]=useState(null);
  const [htReport,setHtReport]=useState(null);
  const [selectedPlayer,setSelectedPlayer]=useState(null);
  const betsRef=useRef([]);
  const toastRef=useRef(null);
  const [apiKey,setApiKey]=useState(()=>localStorage.getItem('isi_api_key')||'');
  const [showApiKeyModal,setShowApiKeyModal]=useState(false);
  const [commentaryFeed,setCommentaryFeed]=useState([]);
  const [homeManagerFeed,setHomeManagerFeed]=useState([]);
  const [awayManagerFeed,setAwayManagerFeed]=useState([]);
  const [homeThoughtsFeed,setHomeThoughtsFeed]=useState([]);
  const [awayThoughtsFeed,setAwayThoughtsFeed]=useState([]);
  const [htLlmQuotes,setHtLlmQuotes]=useState(null);
  const agentSystemRef=useRef(null);
  // Ref for the CosmicArchitect instance.  Kept as a ref (not state) for the
  // same reason as agentSystemRef: the Architect is mutated in place across
  // every minute tick and we don't want React to re-render on each mutation.
  const architectRef=useRef(null);
  const lastEventCountRef=useRef(0);
  const lastThoughtsCountRef=useRef(0);
  // Tracks whether the user has manually scrolled away from the top of the
  // commentary feed.  When true, auto-scroll is suppressed so new entries
  // don't yank the viewport back while the user is reading older content.
  // Intentionally a ref (not state) — we don't want a re-render on scroll.
  const commentaryUserScrolledRef=useRef(false);

  /**
   * onScroll handler for the commentary feed container.
   * Sets commentaryUserScrolledRef to true once the user scrolls more than
   * 40 px from the top, and back to false when they return near the top.
   * The 40 px threshold prevents accidental micro-scrolls from locking
   * auto-scroll permanently.
   */
  const handleCommentaryScroll=()=>{
    if(evtLogRef.current) commentaryUserScrolledRef.current=evtLogRef.current.scrollTop>40;
  };

  // Auto-scroll the commentary feed to the top when new items arrive, but
  // only when the user hasn't scrolled down.  This preserves the "latest
  // event always visible" default while letting users read history freely.
  useEffect(()=>{if(evtLogRef.current&&!commentaryUserScrolledRef.current)evtLogRef.current.scrollTop=0;},[commentaryFeed]);
  useEffect(()=>{return()=>{clearInterval(intervalRef.current);clearTimeout(toastRef.current);};},[]);
  useEffect(()=>{if(matchState.isPlaying){clearInterval(intervalRef.current);intervalRef.current=setInterval(simulateMinute,speed);}},[speed,matchState.isPlaying]);

  // Route a single LLM result to the correct feed.
  //
  // New types added for the Architect + play-by-play system:
  //
  //   'play_by_play'          → commentaryFeed  (Captain Vox primary narration;
  //                             styled differently from 'commentator' reactions
  //                             but lives in the same panel for feed continuity)
  //
  //   'architect_proclamation'→ commentaryFeed  (The Architect's cosmic decree;
  //                             rendered via ArchitectCard for visual distinction)
  //
  // All other types are unchanged from the original routing logic.
  const routeAgentResult=(r)=>{
    if(!r)return;
    if(r.type==='commentator'||r.type==='referee'||r.type==='play_by_play'||r.type==='architect_proclamation'){
      setCommentaryFeed(p=>[...p,r].slice(-120));
    }else if(r.type==='player_thought'){
      if(r.isHome)setHomeThoughtsFeed(p=>[...p,r].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,r].slice(-60));
    }else if(r.type==='manager'){
      if(r.isHome)setHomeManagerFeed(p=>[...p,r].slice(-40));
      else setAwayManagerFeed(p=>[...p,r].slice(-40));
    }
  };

  // Classify and route a procedural (no-LLM) event to the correct feed
  const routeFallbackEvent=(event,homeShortName)=>{
    if(!event||!event.commentary)return;
    const isHome=event.team===homeShortName;
    const managerTypes=['team_talk','manager_shout','desperate_sub','manager_sentoff','siege_start'];
    const thoughtTypes=['captain_rally'];
    const skipTypes=['social','penalty_incident','penalty_injury_concern','penalty_red_card',
      'penalty_yellow_card','penalty_reaction','penalty_awarded','penalty_taker_change',
      'penalty_tension','var_check','var_decision'];
    if(skipTypes.some(t=>event.type===t))return;
    if(managerTypes.includes(event.type)){
      const item={type:'manager',isHome,text:event.commentary,minute:event.minute,emoji:'🧑‍💼',name:isHome?aiManager?.homeManager?.name||'Manager':aiManager?.awayManager?.name||'Manager',color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeManagerFeed(p=>[...p,item].slice(-40));
      else setAwayManagerFeed(p=>[...p,item].slice(-40));
    }else if(thoughtTypes.includes(event.type)){
      const item={type:'player_thought',isHome,text:event.commentary,minute:event.minute,emoji:'💭',name:event.player||'Player',color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeThoughtsFeed(p=>[...p,item].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,item].slice(-60));
    }else{
      setCommentaryFeed(p=>[...p,{type:'commentary',text:event.commentary,minute:event.minute,isGoal:event.isGoal,cardType:event.cardType}].slice(-120));
    }
  };

  // Agent event processing: watch for new events, trigger LLM or route fallback.
  //
  // ── Event routing ─────────────────────────────────────────────────────────
  // Each new event is queued through AgentSystem (Vox play-by-play → reactors
  // → managers → referee → player thought).  queueEvent() returns a Promise
  // that resolves with the AI-generated feed items when the event is finally
  // processed from the internal queue.
  //
  // ── Architect timing ──────────────────────────────────────────────────────
  // maybeUpdate() is called ONCE per batch (outside the per-event loop) rather
  // than once per event.  Calling it inside the loop would invoke it N times
  // per tick (once per event in the batch), creating unnecessary API calls even
  // though the internal time/event guard prevents duplicate Proclamations.
  // Firing once per batch is cleaner: the Architect assesses the full newEvents
  // array in one call and decides whether a Proclamation is due.
  useEffect(()=>{
    if(!matchState.events.length)return;
    const newEvents=matchState.events.slice(lastEventCountRef.current);
    lastEventCountRef.current=matchState.events.length;
    if(!newEvents.length)return;
    const sys=agentSystemRef.current;
    const arch=architectRef.current;
    const allAgents=aiManager?[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents]:[];
    const gameState={minute:matchState.minute,score:matchState.score};

    // ── Queue individual events through AgentSystem ────────────────────────
    for(const event of newEvents){
      if(!event)continue;
      if(sys){
        sys.queueEvent(event,gameState,allAgents).then(results=>{
          results.forEach(routeAgentResult);
        });
      }else{
        routeFallbackEvent(event,matchState.homeTeam.shortName);
      }
    }

    // ── Architect: one check per batch, not per event ──────────────────────
    // maybeUpdate() internally guards against over-firing (time threshold +
    // major-event check), so this is safe to call on every tick.
    if(sys&&arch){
      arch.maybeUpdate(matchState.minute,newEvents,gameState,allAgents)
        .then(proclamation=>{if(proclamation)routeAgentResult(proclamation);})
        .catch(()=>{});
    }
  },[matchState.events]);

  // Route procedural player thoughts (no-LLM fallback) to team panels
  useEffect(()=>{
    if(agentSystemRef.current)return; // LLM handles thoughts
    const thoughts=matchState.aiThoughts||[];
    if(thoughts.length<=lastThoughtsCountRef.current)return;
    const newThoughts=thoughts.slice(lastThoughtsCountRef.current);
    lastThoughtsCountRef.current=thoughts.length;
    for(const t of newThoughts){
      const isHome=matchState.homeTeam.players.some(p=>p.name===t.player);
      const item={type:'player_thought',isHome,text:t.text,minute:t.minute,emoji:t.emoji,name:t.player,color:isHome?matchState.homeTeam.color:matchState.awayTeam.color};
      if(isHome)setHomeThoughtsFeed(p=>[...p,item].slice(-60));
      else setAwayThoughtsFeed(p=>[...p,item].slice(-60));
    }
  },[matchState.aiThoughts]);

  // Halftime: generate LLM quotes when htReport appears
  useEffect(()=>{
    if(!htReport){setHtLlmQuotes(null);return;}
    const sys=agentSystemRef.current;
    if(!sys)return;
    setHtLlmQuotes(null);
    sys.generateHalftimeQuote(true,htReport.score,htReport.goals||[]).then(q=>{
      if(q)setHtLlmQuotes(prev=>({...prev||{},home:q}));
    });
    sys.generateHalftimeQuote(false,htReport.score,htReport.goals||[]).then(q=>{
      if(q)setHtLlmQuotes(prev=>({...prev||{},away:q}));
    });
  },[!!htReport]);

  // ── Auto-start effect ─────────────────────────────────────────────────────
  // When the `autoStart` prop is true (used by compact match cards on the
  // Matches page), kick off the simulation automatically after `startDelay` ms.
  // The delay allows multiple card instances to stagger their starts so they
  // don't all fire interval callbacks on the same tick, reducing jank.
  // We intentionally skip the API key / AgentSystem setup here — compact cards
  // run procedural commentary only (no LLM calls) to keep resource usage low.
  useEffect(()=>{
    if(!autoStart)return;
    const timer=setTimeout(()=>{
      const mgr=createAIManager(TEAMS[homeTeamKey]||TEAMS.mars,TEAMS[awayTeamKey]||TEAMS.saturn);
      aiRef.current=mgr;
      setAiManager(mgr);
      setSpeed(200); // turbo — compact cards run fast
      setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
    },startDelay);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);// intentionally run once on mount only

  const simulateMinute=()=>{
    setMatchState(prev=>{
      const aim=aiRef.current;
      if(prev.minute===45&&!prev.inStoppageTime)return{...prev,stoppageTime:rndI(1,3),inStoppageTime:true};
      if(prev.minute===90&&!prev.inStoppageTime)return{...prev,stoppageTime:rndI(2,5),inStoppageTime:true};
      if((prev.minute===45&&prev.inStoppageTime&&prev.stoppageTime===0)||(prev.minute>=90&&prev.inStoppageTime&&prev.stoppageTime===0)){
        if(prev.minute>=90){clearInterval(intervalRef.current);const mvp=calcMVP(prev.playerStats,prev.homeTeam,prev.awayTeam);return{...prev,isPlaying:false,mvp};}
        clearInterval(intervalRef.current);
        const htGoals=prev.events.filter(e=>e.isGoal);
        const htCards=prev.events.filter(e=>e.cardType);
        const htShots=prev.events.filter(e=>e.type==='shot');
        const mgr=aiRef.current;
        const hDiff=prev.score[0]-prev.score[1];
        const homeQuote=pick(hDiff>=0?TUNNEL_Q[1]:TUNNEL_Q[0]);
        const awayQuote=pick(hDiff<=0?TUNNEL_Q[1]:TUNNEL_Q[0]);
        setTimeout(()=>setHtReport({score:[...prev.score],goals:htGoals,cards:htCards,shots:htShots.length,homeManager:mgr?.homeManager.name||'Home Manager',awayManager:mgr?.awayManager.name||'Away Manager',homeQuote,awayQuote,homeTeam:prev.homeTeam,awayTeam:prev.awayTeam,playerStats:prev.playerStats}),50);
        return{...prev,isPlaying:false,inStoppageTime:false,stoppageTime:0};
      }
      const newMin=prev.inStoppageTime?prev.minute:prev.minute+1;
      const newStop=prev.inStoppageTime&&prev.stoppageTime>0?prev.stoppageTime-1:prev.stoppageTime;
      let interventions=[];
      let newSocial=[...prev.socialFeed];
      let newThoughts=[...prev.aiThoughts];
      let aiInfluence=null;
      const newActive={...prev.activePlayers};
      let newSubsUsed={...prev.substitutionsUsed};
      let newRedCards={...prev.redCards};
      const newStats={...prev.playerStats};
      let newManagerSentOff={...prev.managerSentOff};
      if(aim){
        const gs={minute:newMin,scoreDiff:prev.score[0]-prev.score[1],score:prev.score,possession:prev.possession,momentum:prev.momentum};
        aiInfluence=aim.getDecisionInfluence(gs);
        aim.updateAllAgents(1);
        if(newMin%3===0&&Math.random()<0.6){
          const all=[...aim.activeHomeAgents,...aim.activeAwayAgents];
          const thinker=pick(all);
          const thought=thinker?.getThought(newMin,gs);
          if(thought)newThoughts.push({minute:newMin,player:thinker.player.name,emoji:PERS_ICON[thinker.personality]||'💭',text:thought});
        }
        if(newMin===46){
          const ht=aim.giveTeamTalk(true,prev.score[0]-prev.score[1]);
          if(ht)interventions.push({minute:45,commentary:`⏸️ HALFTIME - ${ht.commentary}`,team:prev.homeTeam.shortName,type:'team_talk',momentumChange:[0,0]});
          const at=aim.giveTeamTalk(false,prev.score[1]-prev.score[0]);
          if(at)interventions.push({minute:45,commentary:`⏸️ HALFTIME - ${at.commentary}`,team:prev.awayTeam.shortName,type:'team_talk',momentumChange:[0,0]});
        }
        if(newMin>70){
          applyLateGameLogic(aim,prev,newMin,interventions,newActive,newSubsUsed,newStats,newManagerSentOff);
        }
        aim.updateManagerEmotion({},prev.score[0],prev.score[1]);
      }
      const chaosLevel=calcChaosLevel(prev,newMin);
      const event=genEvent(newMin,prev.homeTeam,prev.awayTeam,prev.momentum,prev.possession,prev.playerStats,prev.score,prev.activePlayers,prev.substitutionsUsed,aiInfluence,aim,chaosLevel,prev.lastEventType);
      if(!event){
        return{...prev,minute:newMin,stoppageTime:newStop,events:[...prev.events,...interventions].filter(Boolean),aiThoughts:newThoughts.slice(-30),socialFeed:newSocial.slice(-20),lastEventType:prev.lastEventType};
      }
      const socialPosts=genSocial(event,newMin,prev);
      newSocial=[...newSocial,...socialPosts].slice(-20);
      if(event.isGoal&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('goal_scored');}
      if(event.outcome==='miss'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('shot_missed');}
      if(event.cardType==='yellow'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('yellow_card');}
      if(event.cardType==='red'&&aim){const a=aim.getAgentByName(event.foulerName||event.player);if(a)a.triggerEmotion('red_card');}
      if(aim)aim.updateManagerEmotion(event,prev.score[0],prev.score[1]);
      let newScore=[...prev.score];
      if(event.isGoal){if(event.team===prev.homeTeam.shortName)newScore[0]++;else newScore[1]++;}
      const swing=event.team===prev.homeTeam.shortName?event.momentumChange[0]:event.momentumChange[1];
      const newMom=[Math.max(-10,Math.min(10,prev.momentum[0]+(event.team===prev.homeTeam.shortName?swing:-swing))),Math.max(-10,Math.min(10,prev.momentum[1]+(event.team===prev.awayTeam.shortName?swing:-swing)))];
      const hStats=teamStats(prev.homeTeam,prev.activePlayers.home);
      const aStats=teamStats(prev.awayTeam,prev.activePlayers.away);
      const basePoss=hStats.technical/(hStats.technical+aStats.technical)*100;
      const mDiff=newMom[0]-newMom[1];
      const newPoss=[Math.max(30,Math.min(70,basePoss+mDiff)),0];
      newPoss[1]=100-newPoss[0];
      if(event.cardType==='red'){
        // Penalty events: the fouler (defender) is tracked separately from the goal scorer
        const redP=event.foulerName||event.player;
        const redTeam=event.foulerTeam||(event.team===prev.homeTeam.shortName?prev.homeTeam.shortName:prev.awayTeam.shortName);
        const isH=redTeam===prev.homeTeam.shortName;
        const key=isH?'home':'away';
        if(redP){newActive[key]=newActive[key].filter(n=>n!==redP);newRedCards[key]=(newRedCards[key]||0)+1;event.substituteInfo={out:redP,in:null};}
      }
      // Stats update
      if(event.isGoal&&event.player)newStats[event.player]={...newStats[event.player],goals:(newStats[event.player]?.goals||0)+1};
      if(event.assister)newStats[event.assister]={...newStats[event.assister],assists:(newStats[event.assister]?.assists||0)+1};
      if(event.outcome==='saved'&&event.defender)newStats[event.defender]={...newStats[event.defender],saves:(newStats[event.defender]?.saves||0)+1};
      if(event.type==='defense'&&event.outcome==='clean_tackle'&&event.player)newStats[event.player]={...newStats[event.player],tackles:(newStats[event.player]?.tackles||0)+1};
      const cardP=event.foulerName||event.player;
      if(event.cardType==='yellow'&&cardP)newStats[cardP]={...newStats[cardP],yellowCard:true};
      if(event.cardType==='red'&&cardP)newStats[cardP]={...newStats[cardP],redCard:true};
      if(event.isInjury&&event.player)newStats[event.player]={...newStats[event.player],injured:true};
      if(event.isInjury&&event.player){
        const isH=event.team===prev.homeTeam.shortName;const key=isH?'home':'away';
        const sub=makeSub(isH?prev.homeTeam:prev.awayTeam,event.player,newActive[key],prev.substitutionsUsed[key],prev.playerStats);
        newActive[key]=sub.newActive;
        if(sub.substitute){event.substituteInfo={out:event.player,in:sub.substitute};newSubsUsed[key]++;if(aim)aim.handleSubstitution(event.player,sub.substitute,isH);newStats[sub.substitute]={...newStats[sub.substitute],subbedOnMinute:newMin,subbedOn:true};}
        else event.substituteInfo={out:event.player,in:null};
      }
      let allEvents=flattenSequences(prev,event,interventions);
      // Post-goal: VAR + celebration + comeback + hat-trick + sub impact
      const pgExtras=buildPostGoalExtras(aim,event,prev,newMin,newScore,newStats,allEvents);
      allEvents=pgExtras.allEvents; newScore=pgExtras.newScore;
      const varOverturned=pgExtras.varOverturned;
      const isKey=event.isGoal&&!varOverturned&&event.animation?.type==='goal';
      return{...prev,minute:isKey?prev.minute:newMin,stoppageTime:newStop,score:newScore,momentum:newMom,possession:newPoss,events:allEvents.filter(Boolean).slice(-150),currentAnimation:isKey?event.animation:null,isPaused:isKey,pauseCommentary:isKey?event.commentary:null,playerStats:newStats,activePlayers:newActive,substitutionsUsed:newSubsUsed,redCards:newRedCards,aiThoughts:newThoughts.slice(-30),socialFeed:newSocial,lastEventType:event.type||prev.lastEventType,managerSentOff:newManagerSentOff};
    });
  };

  const startSecondHalf=()=>{
    setHtReport(null);
    setMatchState(p=>({...p,minute:46,isPlaying:true,isPaused:false}));
  };
  const startMatch=()=>{
    if(matchState.isPlaying)return;
    let mgr=aiRef.current;
    if(!mgr){mgr=createAIManager(matchState.homeTeam,matchState.awayTeam);aiRef.current=mgr;setAiManager(mgr);}
    if(apiKey&&!agentSystemRef.current){
      // ── Create the Architect before AgentSystem so it can be passed in ───
      // The Architect loads its persistent lore from localStorage at construction
      // time, meaning cross-match rivalries and player arcs are available from
      // the very first Proclamation of this match.
      const arch=new CosmicArchitect(apiKey,{
        homeTeam:matchState.homeTeam,awayTeam:matchState.awayTeam,
        homeManager:mgr.homeManager,awayManager:mgr.awayManager,
        stadium:mgr.stadium,weather:mgr.weather,
      });
      architectRef.current=arch;

      // Pass the Architect instance into AgentSystem so _ctx() can inject its
      // context into every AI prompt without App.jsx needing to coordinate that.
      agentSystemRef.current=new AgentSystem(apiKey,{
        homeTeam:matchState.homeTeam,awayTeam:matchState.awayTeam,
        referee:mgr.referee,homeManager:mgr.homeManager,awayManager:mgr.awayManager,
        homeTactics:mgr.homeTactics,awayTactics:mgr.awayTactics,
        stadium:mgr.stadium,weather:mgr.weather,
        architect:arch,
      });
    }
    setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
    setShowBetting(false);
  };
  const pauseMatch=()=>{clearInterval(intervalRef.current);setMatchState(p=>({...p,isPlaying:false}));};
  const resumeMatch=()=>{if(matchState.minute<90||matchState.inStoppageTime){setMatchState(p=>({...p,isPlaying:true,isPaused:false}));intervalRef.current=setInterval(simulateMinute,speed);}};
  const resetMatch=()=>{
    clearInterval(intervalRef.current);
    aiRef.current=null;
    agentSystemRef.current=null;
    // Clear the Architect ref so the next match starts with a fresh in-match
    // state (narrativeArc, characterArcs, featuredMortals).  The persistent
    // lore in localStorage is NOT cleared — that accumulates across resets.
    architectRef.current=null;
    lastEventCountRef.current=0;
    lastThoughtsCountRef.current=0;
    setAiManager(null);setMatchState(initState());setShowBetting(true);
    setCurrentBets([]);betsRef.current=[];setBetAmount(100);setBetResult(null);
    setHtReport(null);setSelectedPlayer(null);setCommentaryFeed([]);
    setHomeManagerFeed([]);setAwayManagerFeed([]);setHomeThoughtsFeed([]);
    setAwayThoughtsFeed([]);setHtLlmQuotes(null);
  };

  const placeBet=(type,amount,odds)=>{
    if(amount<=0||amount>credits)return;
    const bet={type,amount,odds:parseFloat(odds)};
    betsRef.current=[...betsRef.current,bet];
    setCredits(c=>c-amount);
    setCurrentBets(b=>[...b,bet]);
    clearTimeout(toastRef.current);
    setBetToast({label:betLabel(type,matchState),amount,odds:parseFloat(odds)});
    toastRef.current=setTimeout(()=>setBetToast(null),2500);
  };
  useEffect(()=>{
    if(matchState.mvp&&!matchState.isPlaying){
      // ── Architect post-match lore save ────────────────────────────────────
      // Fire-and-forget: we don't await this because the lore save is a
      // best-effort background operation and must never block the end-of-match
      // UI flow.  The Architect generates a Verdict and merges player arcs,
      // rivalry threads, and season arcs into localStorage for use in future
      // matches.  leagueContext is intentionally minimal here; league pages
      // can pass richer context (season, matchday) in a future integration.
      const arch=architectRef.current;
      if(arch){
        arch.saveMatchToLore(matchState,{
          league: matchState.homeTeam?.league || 'Intergalactic Soccer League',
        });
      }
    }
    if(matchState.mvp&&!matchState.isPlaying&&betsRef.current.length>0){
      const score=matchState.score;
      const hadRed=matchState.redCards.home>0||matchState.redCards.away>0;
      const hWin=score[0]>score[1],aWin=score[1]>score[0],isDraw=score[0]===score[1];
      const total=score[0]+score[1];
      let gain=0,won=0,lost=0;
      const bets=betsRef.current.map(bet=>{
        const firstGoal=matchState.events.find(e=>e.isGoal);
        const btts=score[0]>0&&score[1]>0;
        const exactScore=bet.type?.startsWith('score_')&&bet.type===`score_${score[0]}_${score[1]}`;
        const firstScorer=bet.type?.startsWith('scorer_')&&firstGoal&&bet.type===`scorer_${firstGoal.player}`;
        const betWon=(bet.type==='homeWin'&&hWin)||(bet.type==='awayWin'&&aWin)||(bet.type==='draw'&&isDraw)||(bet.type==='over25'&&total>=3)||(bet.type==='under25'&&total<3)||(bet.type==='redCard'&&hadRed)||(bet.type==='btts'&&btts)||(bet.type==='nobtts'&&!btts)||exactScore||firstScorer;
        const payout=betWon?Math.floor(bet.amount*bet.odds):0;
        if(betWon){gain+=payout;won++;}else lost++;
        return{...bet,won:betWon,payout};
      });
      if(gain>0)setCredits(c=>c+gain);
      setBetResult({gain,won,lost,total:betsRef.current.length,bets,finalScore:score,hadRed});
      betsRef.current=[];
      setCurrentBets([]);
    }
  },[matchState.mvp,matchState.isPlaying]);

  // ── Memoised derived values ────────────────────────────────────────────────
  // All four blocks below are recalculated only when their specific inputs
  // change, preventing redundant work on every unrelated state update.

  // Betting odds — only change when team rosters or squad depth changes.
  const odds = useMemo(
    () => getOdds(matchState.homeTeam, matchState.awayTeam, matchState.activePlayers),
    [matchState.homeTeam, matchState.awayTeam, matchState.activePlayers],
  );

  // Chaos level — recalculate only when score, minute, cards, or agent
  // emotions change.  Avoids an O(n) event scan on every render.
  const chaosLevel = useMemo(() => {
    let c = 0;
    const diff = Math.abs(matchState.score[0] - matchState.score[1]);
    if (diff === 0) c += 30; else if (diff === 1) c += 20;  // 30/20 — tied/close tension bonus
    if (matchState.minute > 80) c += 25; else if (matchState.minute > 70) c += 15; // late-game urgency
    c += matchState.events.filter(e => e.cardType).length * 8; // 8 pts per card shown
    c += (matchState.redCards.home || 0) * 20 + (matchState.redCards.away || 0) * 20; // 20 pts per red
    if (aiManager) {
      const angry = [...aiManager.activeHomeAgents, ...aiManager.activeAwayAgents]
        .filter(a => a.emotion === 'ecstatic' || a.emotion === 'anxious').length;
      c += angry * 5; // 5 pts per emotionally charged agent
    }
    return Math.min(100, c);
  }, [matchState.score, matchState.minute, matchState.events, matchState.redCards, aiManager]);

  const chaosColor = chaosLevel < 20 ? C.purple : chaosLevel < 40 ? C.dust : chaosLevel < 60 ? '#FFA500' : chaosLevel < 80 ? C.red : '#FF0000';
  const chaosLabel = chaosLevel < 20 ? 'CALM'   : chaosLevel < 40 ? 'TENSE' : chaosLevel < 60 ? 'HEATED'  : chaosLevel < 80 ? 'CHAOTIC' : 'MAYHEM';

  const ms = matchState;

  // ── Derived match statistics ───────────────────────────────────────────────
  // Six filter passes over the event log, memoised as a single block so they
  // only rerun when the events array reference changes (i.e. each new minute),
  // not on every re-render triggered by other state updates.
  const sn  = ms.homeTeam.shortName;
  const asn = ms.awayTeam.shortName;
  const {
    homeShots, awayShots, homeSoT, awaySoT, homeCorners, awayCorners,
    homeYellows, awayYellows,
  } = useMemo(() => ({
    // Shot counts include both attempts that ended in goals and standalone shots.
    homeShots:   ms.events.filter(e => e.team === sn  && (e.type === 'shot' || e.isGoal)).length,
    awayShots:   ms.events.filter(e => e.team === asn && (e.type === 'shot' || e.isGoal)).length,
    // On target = saved by keeper OR converted to goal.
    homeSoT:     ms.events.filter(e => e.team === sn  && (e.isGoal || e.outcome === 'saved')).length,
    awaySoT:     ms.events.filter(e => e.team === asn && (e.isGoal || e.outcome === 'saved')).length,
    homeCorners: ms.events.filter(e => e.team === sn  && e.type === 'corner').length,
    awayCorners: ms.events.filter(e => e.team === asn && e.type === 'corner').length,
    // Yellow card fouls: check both primary team and foulerTeam since the fouling
    // player may be from the opposite team to the event's main team.
    homeYellows: ms.events.filter(e => e.cardType === 'yellow' && (e.team === sn  || e.foulerTeam === sn)).length,
    awayYellows: ms.events.filter(e => e.cardType === 'yellow' && (e.team === asn || e.foulerTeam === asn)).length,
  }), [ms.events, sn, asn]);

  // ── Key match events (goals, cards, subs) ─────────────────────────────────
  // Filtered from ms.events for display in the timeline strip above the
  // commentary feed.  Only significant events are included so the strip stays
  // scannable — routine play (corners, fouls, etc.) is intentionally omitted.
  // Memoised on ms.events so it only recomputes when a new event is appended.
  const keyEvents = useMemo(() => ms.events.filter(e =>
    e.isGoal || e.cardType === 'red' || e.cardType === 'yellow' || e.type === 'substitution'
  ), [ms.events]);

  // ── Reversed feed arrays ───────────────────────────────────────────────────
  // Each feed is displayed newest-first (reverse order) in the UI.
  // Memoised so a new reversed array is only allocated when the source feed
  // changes, not on every unrelated re-render (e.g. score updates).
  const commentaryReversed    = useMemo(() => [...commentaryFeed].reverse(),    [commentaryFeed]);
  const homeManagerReversed   = useMemo(() => [...homeManagerFeed].reverse(),   [homeManagerFeed]);
  const awayManagerReversed   = useMemo(() => [...awayManagerFeed].reverse(),   [awayManagerFeed]);
  const homeThoughtsReversed  = useMemo(() => [...homeThoughtsFeed].reverse(),  [homeThoughtsFeed]);
  const awayThoughtsReversed  = useMemo(() => [...awayThoughtsFeed].reverse(),  [awayThoughtsFeed]);

  // ── Time display helpers ───────────────────────────────────────────────────
  // Formats the clock string shown in the scoreboard and compact card header.
  // Stoppage time is displayed as "45+N'" or "90+N'" per football convention.
  const timeDisplay=ms.inStoppageTime
    ?`${ms.minute>=90?90:45}+${Math.max(0,ms.minute>=90?ms.minute-90:ms.minute-45)}'`
    :`${ms.minute}'`;
  const periodLabel=ms.inStoppageTime?'Stoppage':ms.minute===0?'Pre-Match':ms.minute<45?'1st Half':ms.minute<90?'2nd Half':ms.mvp?'Full Time':'2nd Half';

  // ── Compact card render ────────────────────────────────────────────────────
  // Returned early when `compact={true}`.  Used by the Matches page to show
  // multiple simultaneously-running simulations in a 2×2 grid.  Only renders
  // the scoreboard, chaos meter, and commentary feed — no squad lists, stats,
  // or modals — to keep each card lightweight.
  if(compact){
    return(
      <div style={{border:'1px solid rgba(227,224,213,0.2)',backgroundColor:'#1F1F1F',display:'flex',flexDirection:'column',fontFamily:"'Space Mono',monospace",color:'#E3E0D5',height:'100%'}}>
        {/* Scoreboard row: short-name | score·time·score | short-name */}
        <div style={{padding:'12px 16px',backgroundColor:'#111',borderBottom:'1px solid rgba(227,224,213,0.07)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:'8px'}}>
            <div style={{textAlign:'right',fontSize:'11px',fontWeight:700,color:ms.homeTeam.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{ms.homeTeam.shortName}</div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'0 4px'}}>
              <span style={{fontSize:'22px',fontWeight:700}}>{ms.score[0]}</span>
              <div style={{textAlign:'center',minWidth:'38px'}}>
                <div style={{fontSize:'10px',fontWeight:700,color:'#9A5CF4'}}>{timeDisplay}</div>
                <div style={{fontSize:'8px',opacity:0.35,textTransform:'uppercase'}}>{periodLabel}</div>
              </div>
              <span style={{fontSize:'22px',fontWeight:700}}>{ms.score[1]}</span>
            </div>
            <div style={{textAlign:'left',fontSize:'11px',fontWeight:700,color:ms.awayTeam.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{ms.awayTeam.shortName}</div>
          </div>
        </div>

        {/* Chaos meter strip with status tags */}
        <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.05)'}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'8px',opacity:0.35,marginBottom:'4px',textTransform:'uppercase'}}>
            <span>😊 Calm</span><span>Tense</span><span>Mayhem 🔥</span>
          </div>
          <div style={{height:'3px',backgroundColor:'rgba(227,224,213,0.06)',position:'relative'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${chaosLevel}%`,backgroundColor:chaosColor,transition:'width 0.5s'}}/>
          </div>
          <div style={{display:'flex',gap:'4px',marginTop:'5px',flexWrap:'wrap'}}>
            {ms.minute>80&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(224,82,82,0.4)',color:'#E05252'}}>LATE GAME</span>}
            {Math.abs(ms.score[0]-ms.score[1])===0&&ms.minute>0&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(255,165,0,0.35)',color:'#FFA500'}}>TIED</span>}
            {(ms.redCards.home+ms.redCards.away)>0&&<span style={{fontSize:'8px',padding:'1px 5px',border:'1px solid rgba(224,82,82,0.4)',color:'#E05252'}}>RED CARDS</span>}
          </div>
        </div>

        {/* Scrollable commentary feed — newest events at top */}
        <div style={{flex:1,overflowY:'auto',padding:'6px 8px',minHeight:'180px',maxHeight:'240px',scrollbarWidth:'thin'}}>
          {commentaryFeed.length===0
            ?<div style={{textAlign:'center',padding:'40px 0',opacity:0.2,fontSize:'10px'}}>{ms.minute===0?'Starting...':'Watching...'}</div>
            :commentaryReversed.slice(0,10).map((item,i)=><AgentCard key={i} item={item}/>)}
        </div>

        {/* Expand button — triggers onExpand prop from parent Matches page */}
        {onExpand&&(
          <div style={{padding:'7px 12px',borderTop:'1px solid rgba(227,224,213,0.05)'}}>
            {/* border opacity 0.2 — matches .card standard */}
          <button onClick={onExpand} style={{width:'100%',padding:'6px',backgroundColor:'transparent',border:'1px solid rgba(227,224,213,0.2)',color:'rgba(227,224,213,0.5)',fontFamily:"'Space Mono',monospace",fontSize:'9px',textTransform:'uppercase',letterSpacing:'0.09em',cursor:'pointer'}}>
              View Full Match ↗
            </button>
          </div>
        )}
        <style>{`@keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}`}</style>
      </div>
    );
  }

  // ── Full match view render ─────────────────────────────────────────────────
  // Rendered when compact={false} (the default).  Implements the ISL match
  // page design: title → scoreboard → controls → officials/stadium →
  // team-info/chaos → manager-feeds/pitch → thoughts/commentary →
  // squad-lists → match-stats/previous-meetings → modals.
  return(
    <div style={{fontFamily:"'Space Mono',monospace",color:'#E3E0D5'}}>

      {/* ── Goal-pause banner ────────────────────────────────────────────────── */}
      {/* Shown fixed at the top of the viewport when a goal freezes the clock.
          The user must click CONTINUE to resume — this gives them time to read
          the commentary before the simulation moves on. */}
      {ms.isPaused&&ms.pauseCommentary&&(
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:50,padding:'14px 24px',textAlign:'center',fontSize:'15px',fontWeight:700,backgroundColor:'#1F1F1F',borderBottom:'1px solid #9A5CF4',color:'#9A5CF4',animation:'fadeIn 0.3s'}}>
          {ms.pauseCommentary}
          <button onClick={resumeMatch} style={{marginLeft:'16px',padding:'6px 14px',border:'1px solid rgba(227,224,213,0.4)',backgroundColor:'#111',color:'#E3E0D5',cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:'12px',letterSpacing:'0.06em'}}>▶ CONTINUE</button>
        </div>
      )}

      <div className="container" style={{paddingTop:'32px',paddingBottom:'60px'}}>
        {/* ── Page title ───────────────────────────────────────────────── */}
        <div className="page-hero" style={{paddingBottom:'24px'}}>
          <h1 style={{color:'#E3E0D5',marginBottom:'8px'}}>
            {ms.homeTeam.shortName} <span style={{color:'#9A5CF4'}}>vs</span> {ms.awayTeam.shortName}
          </h1>
          <div style={{display:'flex',justifyContent:'center',gap:'8px',flexWrap:'wrap'}}>
            {ms.minute>80&&<span style={{padding:'4px 10px',backgroundColor:'#E05252',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Late Game</span>}
            {Math.abs(ms.score[0]-ms.score[1])===0&&ms.minute>30&&<span style={{padding:'4px 10px',backgroundColor:'#7A3ED4',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Tied</span>}
            {(ms.redCards.home+ms.redCards.away)>0&&<span style={{padding:'4px 10px',backgroundColor:'#E05252',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>Red Cards</span>}
            {ms.mvp&&<span style={{padding:'4px 10px',backgroundColor:'#1F1F1F',border:'1px solid #9A5CF4',fontSize:'11px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9A5CF4'}}>Full Time</span>}
          </div>
        </div>

        {/* ── Scoreboard card ───────────────────────────────────────────── */}
        <div className="card section" style={{position:'relative',overflow:'hidden'}}>
          {ms.currentAnimation?.type==='goal'&&(
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:10}}>
              <div style={{fontSize:'96px',animation:'goalPulse 2s ease-out forwards'}}>⚽</div>
            </div>
          )}
          {ms.currentAnimation?.type==='saved'&&(
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:10}}>
              <div style={{fontSize:'96px',animation:'goalPulse 2s ease-out forwards'}}>✋</div>
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:'16px',alignItems:'center'}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'13px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:ms.homeTeam.color,marginBottom:'8px',opacity:0.8}}>{ms.homeTeam.name}</div>
              <div style={{fontSize:'72px',fontWeight:700,lineHeight:1,color:'#E3E0D5'}}>{ms.score[0]}</div>
            </div>
            <div style={{textAlign:'center',minWidth:'120px'}}>
              <div style={{fontSize:'28px',fontWeight:700,color:'#9A5CF4',marginBottom:'4px'}}>{timeDisplay}</div>
              <div style={{fontSize:'11px',letterSpacing:'0.1em',textTransform:'uppercase',opacity:0.5,marginBottom:'10px'}}>{periodLabel}</div>
              <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'11px'}}>
                <span style={{color:ms.homeTeam.color}}>{ms.possession[0].toFixed(0)}%</span>
                <div style={{flex:1,height:'4px',backgroundColor:'#111111',position:'relative'}}>
                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${ms.possession[0]}%`,backgroundColor:ms.homeTeam.color}}/>
                </div>
                <span style={{color:ms.awayTeam.color}}>{ms.possession[1].toFixed(0)}%</span>
              </div>
              <div style={{fontSize:'10px',opacity:0.4,marginTop:'3px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Possession</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'13px',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:ms.awayTeam.color,marginBottom:'8px',opacity:0.8}}>{ms.awayTeam.name}</div>
              <div style={{fontSize:'72px',fontWeight:700,lineHeight:1,color:'#E3E0D5'}}>{ms.score[1]}</div>
            </div>
          </div>
          {ms.mvp&&(
            <div style={{marginTop:'20px',padding:'12px 16px',backgroundColor:'rgba(154,92,244,0.1)',border:'1px solid rgba(154,92,244,0.3)',display:'flex',alignItems:'center',gap:'12px'}}>
              <div style={{fontSize:'20px'}}>⭐</div>
              <div>
                <div style={{fontSize:'10px',color:'#9A5CF4',textTransform:'uppercase',letterSpacing:'0.08em'}}>Match MVP</div>
                <div style={{fontSize:'14px',fontWeight:700,color:ms.mvp.teamColor}}>{ms.mvp.name}</div>
                <div style={{fontSize:'11px',opacity:0.5}}>{ms.mvp.position} · {ms.mvp.team}</div>
              </div>
              <div style={{marginLeft:'auto',display:'flex',gap:'16px',fontSize:'12px'}}>
                {ms.mvp.stats.goals>0&&<span>⚽ {ms.mvp.stats.goals}</span>}
                {ms.mvp.stats.assists>0&&<span>👟 {ms.mvp.stats.assists}</span>}
                {ms.mvp.stats.saves>0&&<span>✋ {ms.mvp.stats.saves}</span>}
              </div>
            </div>
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div className="section" style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
          {!ms.isPlaying&&ms.minute===0&&(
            <button onClick={startMatch} className="btn btn-tertiary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Play size={14}/> Kick Off
            </button>
          )}
          {ms.isPlaying&&(
            <button onClick={pauseMatch} className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Pause size={14}/> Pause
            </button>
          )}
          {!ms.isPlaying&&ms.minute>0&&ms.minute<90&&!ms.mvp&&(
            <button onClick={resumeMatch} className="btn btn-tertiary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <Play size={14}/> Resume
            </button>
          )}
          <button onClick={resetMatch} className="btn btn-primary" style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <RotateCcw size={14}/> Reset
          </button>
          <div style={{display:'flex',gap:'4px',marginLeft:'auto'}}>
            {/* Speed selector — 2000ms=Slow … 200ms=Turbo */}
            {[['SLOW',2000],['NORMAL',1000],['FAST',500],['TURBO',200]].map(([label,spd])=>(
              <button key={spd} onClick={()=>setSpeed(spd)} className="btn" style={{
                padding:'6px 12px',fontSize:'11px',
                backgroundColor:speed===spd?'#9A5CF4':'#111111',
                border:`1px solid ${speed===spd?'#9A5CF4':'rgba(227,224,213,0.3)'}`,
                color:speed===spd?'#E3E0D5':'rgba(227,224,213,0.5)',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* ── Officials / Stadium / Weather ─────────────────────────────── */}
        {aiManager&&(
          <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px'}}>
            <div className="card" style={{padding:'16px'}}>
              <div style={{fontSize:'11px',opacity:0.5,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'8px'}}>Referee</div>
              <div style={{fontSize:'20px',marginBottom:'4px'}}>{aiManager.referee.leniency>70?'😊':aiManager.referee.leniency>40?'😐':'😠'}</div>
              <div style={{fontSize:'13px',fontWeight:700}}>{aiManager.referee.name}</div>
              <div style={{fontSize:'11px',marginTop:'4px',color:aiManager.referee.leniency>70?'#A5D6A7':aiManager.referee.leniency>40?'#E3E0D5':'#E05252'}}>
                {aiManager.referee.leniency>70?'Lenient':aiManager.referee.leniency>40?'Fair':'Strict'}
              </div>
            </div>
            <div className="card" style={{padding:'16px'}}>
              <div style={{fontSize:'11px',opacity:0.5,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'8px'}}>Stadium</div>
              <div style={{fontSize:'13px',fontWeight:700,marginBottom:'4px'}}>{aiManager.stadium.name}</div>
              <div style={{fontSize:'11px',opacity:0.5}}>Cap. {aiManager.stadium.capacity?.toLocaleString()??'–'}</div>
            </div>
            <div className="card" style={{padding:'16px'}}>
              <div style={{fontSize:'11px',opacity:0.5,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'8px'}}>Conditions</div>
              <div style={{fontSize:'20px',marginBottom:'4px'}}>{WX_ICON[aiManager.weather]||'🌌'}</div>
              <div style={{fontSize:'13px',fontWeight:700}}>{aiManager.weather.replace(/_/g,' ').toUpperCase()}</div>
              <div style={{fontSize:'11px',opacity:0.5,marginTop:'4px'}}>{aiManager.temperature}°C · {aiManager.timeOfDay}</div>
            </div>
          </div>
        )}

        {/* ── Chaos meter + match stats ─────────────────────────────────── */}
        <div className="card section">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:chaosColor}}>Chaos Meter</div>
            <div style={{fontSize:'11px',fontWeight:700,color:chaosColor}}>{chaosLabel}</div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',opacity:0.5,marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.06em'}}>
            <span>Calm</span><span>Tense</span><span>Mayhem</span>
          </div>
          {/* Chaos bar — width driven by chaosLevel 0–100 */}
          <div style={{height:'8px',backgroundColor:'#111111',position:'relative',marginBottom:'16px'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${chaosLevel}%`,backgroundColor:chaosColor,boxShadow:`0 0 8px ${chaosColor}`,transition:'width 0.5s'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px',fontSize:'12px',textAlign:'center'}}>
            {[
              ['Shots',homeShots,awayShots],
              ['On Target',homeSoT,awaySoT],
              ['Corners',homeCorners,awayCorners],
              ['Yellows',homeYellows,awayYellows],
            ].map(([label,h,a])=>(
              <div key={label}>
                <div style={{fontSize:'10px',opacity:0.5,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'4px'}}>{label}</div>
                <div style={{display:'flex',justifyContent:'center',gap:'8px'}}>
                  <span style={{fontWeight:700,color:ms.homeTeam.color}}>{h}</span>
                  <span style={{opacity:0.3}}>–</span>
                  <span style={{fontWeight:700,color:ms.awayTeam.color}}>{a}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3-column feeds: manager / pitch+commentary / manager ──────── */}
        {aiManager&&(
          <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1fr',gap:'16px',height:'600px'}}>
            {/* Layout contract for this section:
                - grid height 600px gives all three columns a fixed block size.
                - Each column wrapper has overflow:hidden so nothing bleeds out.
                - Feed divs use explicit fixed heights (same pattern as Manager
                  Shouts, which has always worked reliably) so overflowY:auto
                  creates a real scroll context without any flex trickery.

                  Heights chosen so both side columns and the centre column
                  total ≈ 590px — safely inside the 600px clip:
                    Side:   team-info(~84) + gap(12) + mgr-shouts(194) +
                            gap(12) + thoughts-header(34) + 250px feed = ~586px
                    Centre: pitch-card(~161) + gap(12) + commentary-header(34)
                            + 380px feed = ~587px

                  380px commentary — fits ~6–8 entries before scrolling.
                  250px player-thoughts — fits ~3–4 entries before scrolling.
                  160px manager-shouts (unchanged) — fits ~2 entries. */}
            {/* ── HOME column ─────────────────────────────────────────── */}
            {/* height:100% works here because the parent grid has an explicit
                height (600px), giving a definite reference for percentage
                resolution. flex:1 on the last card then reliably fills the
                remaining column space. */}
            <div style={{display:'flex',flexDirection:'column',gap:'12px',height:'100%',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px',borderColor:ms.homeTeam.color}}>
                <div style={{fontSize:'13px',fontWeight:700,color:ms.homeTeam.color,marginBottom:'4px'}}>{ms.homeTeam.name}</div>
                <div style={{fontSize:'11px',opacity:0.6}}>{aiManager.homeFormation} · {aiManager.homeTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'6px',fontSize:'12px'}}>
                  <span>{EMO_ICON[aiManager.homeManager.emotion]||'😐'}</span>
                  <span style={{fontWeight:700,color:ms.homeTeam.color}}>{aiManager.homeManager.name}</span>
                  <span style={{marginLeft:'auto',fontSize:'11px',opacity:0.5}}>{ms.substitutionsUsed.home}/3 subs</span>
                </div>
              </div>
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.homeTeam.color}}>Manager Shouts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'160px',scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} #111`}}>
                  {homeManagerFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'48px'}}>Watching from the touchline...</div>
                    :homeManagerReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span style={{fontWeight:700,color:ms.homeTeam.color}}>{item.emoji} {item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              {/* Player Thoughts — flex:1 so this card stretches to fill remaining column
                  height, keeping the home/away columns flush with the taller centre
                  column. minHeight preserves a sensible floor when content is sparse. */}
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.homeTeam.color}}>Player Thoughts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'250px',scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} #111`}}>
                  {homeThoughtsFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'64px'}}>Quiet minds...</div>
                    :homeThoughtsReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span>{item.emoji}</span>
                          <span style={{fontWeight:700,color:item.color||ms.homeTeam.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4,flexShrink:0}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* ── CENTRE: pitch + commentary ──────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:'12px',height:'100%',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px'}}>
                <div style={{fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#9A5CF4',marginBottom:'10px',textAlign:'center'}}>Live Pitch</div>
                <div style={{position:'relative',height:'88px',backgroundColor:'#1a4d2e',border:'1px solid rgba(227,224,213,0.2)',backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(255,255,255,0.04) 19px,rgba(255,255,255,0.04) 20px)'}}>
                  <div style={{position:'absolute',left:'50%',top:0,bottom:0,width:'1px',backgroundColor:'rgba(227,224,213,0.2)'}}/>
                  <div style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',width:'36px',height:'36px',borderRadius:'50%',border:'1px solid rgba(227,224,213,0.2)'}}/>
                  <div style={{position:'absolute',left:0,top:'50%',transform:'translateY(-50%)',width:'10px',height:'32px',border:`1px solid ${ms.homeTeam.color}`,borderLeft:'none',backgroundColor:`${ms.homeTeam.color}20`}}/>
                  <div style={{position:'absolute',right:0,top:'50%',transform:'translateY(-50%)',width:'10px',height:'32px',border:`1px solid ${ms.awayTeam.color}`,borderRight:'none',backgroundColor:`${ms.awayTeam.color}20`}}/>
                  {/* Ball moves with possession percentage */}
                  <div style={{position:'absolute',top:'50%',transform:'translateY(-50%)',fontSize:'16px',transition:'left 1s',left:`calc(${ms.possession[0]}% - 8px)`}}>⚽</div>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',opacity:0.5,marginTop:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>
                  <span style={{color:ms.homeTeam.color}}>{ms.homeTeam.shortName}{ms.possession[0]>55?' ⚔':''}</span>
                  <span>{ms.possession[0]>55?'ATTACKING':ms.possession[0]<45?`${ms.awayTeam.shortName} ATTACKING`:'MIDFIELD'}</span>
                  <span style={{color:ms.awayTeam.color}}>{ms.possession[1]>55?'⚔ ':''}{ms.awayTeam.shortName}</span>
                </div>
              </div>
              {/* ── Key Events Timeline ──────────────────────────────────────
                  Compact strip showing only goals, cards, and substitutions in
                  chronological order (oldest left → newest right).  Routine
                  events (corners, fouls, etc.) are omitted to keep this strip
                  scannable at a glance.  Each chip is colour-coded by team and
                  event type so the match story is readable without scrolling
                  through the full commentary feed.
                  Empty-state placeholder is shown until the first key event
                  so the card doesn't collapse to zero height. */}
              <div className="card" style={{padding:'8px 12px'}}>
                <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'rgba(227,224,213,0.4)',marginBottom:'6px'}}>Match Events</div>
                {keyEvents.length===0
                  ?<div style={{fontSize:'10px',opacity:0.25,fontStyle:'italic'}}>No key events yet</div>
                  :<div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                    {keyEvents.map((e,i)=>{
                      // Determine chip icon and colour based on event type.
                      // Goals use the scoring team's colour for instant visual
                      // association; cards use standard football colours
                      // (red/yellow); subs use a neutral grey.
                      const isHome=e.team===sn;
                      const teamColor=isHome?ms.homeTeam.color:ms.awayTeam.color;
                      const icon=e.isGoal?'⚽':e.cardType==='red'?'🟥':e.cardType==='yellow'?'🟨':'🔄';
                      const borderColor=e.isGoal?teamColor:e.cardType==='red'?'#E05252':e.cardType==='yellow'?'#FFD700':'rgba(227,224,213,0.3)';
                      const label=e.isGoal?`${e.minute}' ${isHome?ms.homeTeam.shortName:ms.awayTeam.shortName}`:`${e.minute}'`;
                      return(
                        <span key={i} title={e.player||e.type} style={{display:'inline-flex',alignItems:'center',gap:'3px',fontSize:'10px',padding:'2px 6px',border:`1px solid ${borderColor}`,color:e.isGoal?teamColor:'rgba(227,224,213,0.7)',backgroundColor:e.isGoal?`${teamColor}10`:'transparent',whiteSpace:'nowrap'}}>
                          {icon} {label}
                        </span>
                      );
                    })}
                  </div>
                }
              </div>

              {/* Commentary card — flex:1 fills the remaining centre-column
                  height after the pitch visualization and events strip.
                  Height reduced to 300px (from 380px) to accommodate the new
                  events card while keeping the overall column height unchanged. */}
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(154,92,244,0.3)',backgroundColor:'rgba(154,92,244,0.06)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#9A5CF4',display:'flex',alignItems:'center',gap:'8px'}}>
                  <span>Commentary</span>
                  {agentSystemRef.current&&(
                    <div style={{display:'flex',gap:'6px',marginLeft:'auto'}}>
                      {COMMENTATOR_PROFILES.map(p=><span key={p.id} style={{fontSize:'13px'}} title={`${p.name} • ${p.role}`}>{p.emoji}</span>)}
                      <span style={{fontSize:'13px'}} title="Referee">⚖️</span>
                    </div>
                  )}
                  {!agentSystemRef.current&&apiKey&&(
                    <span style={{marginLeft:'auto',fontSize:'10px',opacity:0.4}}>key set — next kick off</span>
                  )}
                  {!agentSystemRef.current&&!apiKey&&(
                    <button onClick={()=>setShowApiKeyModal(true)} style={{marginLeft:'auto',fontSize:'10px',padding:'2px 8px',border:'1px solid rgba(154,92,244,0.5)',backgroundColor:'transparent',color:'#9A5CF4',cursor:'pointer',fontFamily:"'Space Mono',monospace",textTransform:'uppercase',letterSpacing:'0.06em'}}>⚙ AI</button>
                  )}
                </div>
                {/* flex:1 fills whatever height the card has been allocated by
                    the 600px grid; overflowY:auto scrolls new entries rather
                    than expanding the div (and therefore the whole column). */}
                <div ref={evtLogRef} onScroll={handleCommentaryScroll} style={{padding:'8px',overflowY:'auto',height:'300px',scrollbarWidth:'thin',scrollbarColor:'#9A5CF4 #111'}}>
                  {commentaryFeed.length===0&&(
                    <div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'80px'}}>
                      {ms.minute===0?'Press Kick Off to begin':'Agents are watching...'}
                    </div>
                  )}
                  {commentaryReversed.map((item,i)=>{
                    // ── The Architect Proclamation ──────────────────────────
                    // Rendered by ArchitectCard which handles all visual styling
                    // including the cosmic void background and pulsing border.
                    if(item.type==='architect_proclamation'){
                      return <ArchitectCard key={i} item={item}/>;
                    }

                    // ── Captain Vox: primary play-by-play narration ─────────
                    // Displayed with a thicker border and slightly larger text
                    // than reaction commentary cards to signal it is the main
                    // "what just happened" entry in the feed, not a reaction.
                    if(item.type==='play_by_play'){
                      return(
                        <div key={i} style={{marginBottom:'14px',borderLeft:`3px solid ${item.color}`,paddingLeft:'10px',backgroundColor:'rgba(255,215,0,0.04)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px',fontSize:'11px'}}>
                            <span style={{fontSize:'15px'}}>{item.emoji}</span>
                            <span style={{fontWeight:700,color:item.color}}>{item.name}</span>
                            {/* 'PRIMARY' badge distinguishes Vox narration from reaction cards */}
                            <span style={{fontSize:'9px',padding:'1px 5px',border:`1px solid ${item.color}`,color:item.color,opacity:0.7,letterSpacing:'0.08em'}}>PRIMARY</span>
                            <span style={{marginLeft:'auto',opacity:0.3,fontSize:'10px'}}>{item.minute}'</span>
                          </div>
                          <div style={{fontSize:'12px',lineHeight:1.55,opacity:0.95,fontStyle:'italic',fontWeight:500}}>"{item.text}"</div>
                        </div>
                      );
                    }

                    // ── Reactor commentators (Nexus-7, Zara Bloom) ──────────
                    // Standard reaction card — thinner border, smaller text,
                    // visually subordinate to the play-by-play entry above.
                    if(item.type==='commentator'){
                      return(
                        <div key={i} style={{marginBottom:'12px',borderLeft:`2px solid ${item.color}`,paddingLeft:'8px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                            <span style={{fontSize:'13px'}}>{item.emoji}</span>
                            <span style={{fontWeight:700,color:item.color}}>{item.name}</span>
                            <span style={{color:item.color,opacity:0.5,fontSize:'10px'}}>{item.role}</span>
                            <span style={{marginLeft:'auto',opacity:0.3,fontSize:'10px'}}>{item.minute}'</span>
                          </div>
                          <div style={{fontSize:'11px',lineHeight:1.5,opacity:0.9,fontStyle:'italic'}}>"{item.text}"</div>
                        </div>
                      );
                    }

                    // ── Referee decision ────────────────────────────────────
                    if(item.type==='referee'){
                      return(
                        <div key={i} style={{marginBottom:'12px',borderLeft:'2px solid #FFD700',paddingLeft:'8px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                            <span style={{fontSize:'13px'}}>⚖️</span>
                            <span style={{fontWeight:700,color:'#FFD700'}}>{item.name}</span>
                            <span style={{marginLeft:'auto',opacity:0.3,fontSize:'10px'}}>{item.minute}'</span>
                          </div>
                          <div style={{fontSize:'11px',lineHeight:1.5,opacity:0.9,fontStyle:'italic'}}>"{item.text}"</div>
                        </div>
                      );
                    }

                    // ── Procedural event entry (fallback / no API key) ───────
                    // Visually de-emphasised relative to the play-by-play card:
                    // dimmer text and thinner border so it reads as a timestamp
                    // reference, not the main narrative voice.
                    const bc=item.isGoal?'#9A5CF4':item.cardType==='red'?'#E05252':item.cardType==='yellow'?'#FFD700':'rgba(227,224,213,0.2)';
                    return(
                      <div key={i} style={{marginBottom:'6px',borderLeft:`1px solid ${bc}`,paddingLeft:'8px',opacity:0.65,backgroundColor:item.isGoal?'rgba(154,92,244,0.05)':item.cardType==='red'?'rgba(224,82,82,0.04)':undefined}}>
                        <div style={{display:'flex',gap:'8px',fontSize:'10px',lineHeight:1.5}}>
                          <span style={{fontWeight:700,color:'#9A5CF4',flexShrink:0}}>{item.minute}'</span>
                          <span style={{opacity:0.8}}>{item.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── AWAY column ─────────────────────────────────────────── */}
            <div style={{display:'flex',flexDirection:'column',gap:'12px',height:'100%',overflow:'hidden'}}>
              <div className="card" style={{padding:'12px',borderColor:ms.awayTeam.color}}>
                <div style={{fontSize:'13px',fontWeight:700,color:ms.awayTeam.color,marginBottom:'4px'}}>{ms.awayTeam.name}</div>
                <div style={{fontSize:'11px',opacity:0.6}}>{aiManager.awayFormation} · {aiManager.awayTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'6px',fontSize:'12px'}}>
                  <span>{EMO_ICON[aiManager.awayManager.emotion]||'😐'}</span>
                  <span style={{fontWeight:700,color:ms.awayTeam.color}}>{aiManager.awayManager.name}</span>
                  <span style={{marginLeft:'auto',fontSize:'11px',opacity:0.5}}>{ms.substitutionsUsed.away}/3 subs</span>
                </div>
              </div>
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.awayTeam.color}}>Manager Shouts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'160px',scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} #111`}}>
                  {awayManagerFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'48px'}}>Watching from the touchline...</div>
                    :awayManagerReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span style={{fontWeight:700,color:ms.awayTeam.color}}>{item.emoji} {item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              {/* Player Thoughts — flex:1 stretches to fill remaining away-column
                  height, keeping the bottom edge aligned with the centre column. */}
              <div className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{padding:'8px 12px',borderBottom:'1px solid rgba(227,224,213,0.1)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:ms.awayTeam.color}}>Player Thoughts</div>
                <div style={{padding:'8px',overflowY:'auto',height:'250px',scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} #111`}}>
                  {awayThoughtsFeed.length===0
                    ?<div style={{textAlign:'center',opacity:0.3,fontSize:'12px',paddingTop:'64px'}}>Quiet minds...</div>
                    :awayThoughtsReversed.map((item,i)=>(
                      <div key={i} style={{marginBottom:'10px',paddingBottom:'8px',borderBottom:'1px solid rgba(227,224,213,0.06)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'3px',fontSize:'11px'}}>
                          <span>{item.emoji}</span>
                          <span style={{fontWeight:700,color:item.color||ms.awayTeam.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span>
                          <span style={{marginLeft:'auto',opacity:0.4,flexShrink:0}}>{item.minute}'</span>
                        </div>
                        <div style={{fontSize:'11px',opacity:0.85,lineHeight:1.5,fontStyle:'italic'}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Pre-match prompt (no AI manager set up yet) */}
        {!aiManager&&!apiKey&&(
          <div className="card section" style={{textAlign:'center'}}>
            <div style={{fontSize:'12px',opacity:0.5,marginBottom:'12px'}}>Commentators, managers &amp; players can be powered by Claude AI</div>
            <button onClick={()=>setShowApiKeyModal(true)} className="btn btn-primary">⚙ Set API Key to Enable Agents</button>
          </div>
        )}
        {!aiManager&&apiKey&&(
          <div className="card section" style={{textAlign:'center',fontSize:'12px',opacity:0.5,padding:'12px'}}>
            🔑 API key set — LLM agents activate on Kick Off
          </div>
        )}

        {/* ── Squad lists ────────────────────────────────────────────────── */}
        <div className="section" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
          {[['home',ms.homeTeam,aiManager?.homeAgents,ms.homeTeam.color],['away',ms.awayTeam,aiManager?.awayAgents,ms.awayTeam.color]].map(([k,team,agents,color])=>(
            <div key={k} className="card" style={{padding:0,overflow:'hidden'}}>
              <div style={{padding:'10px 16px',borderBottom:'1px solid rgba(227,224,213,0.15)',fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color}}>
                {team.name} · {ms.substitutionsUsed[k]}/3 Subs
              </div>
              <div style={{padding:'8px 0'}}>
                <div style={{padding:'4px 16px',fontSize:'10px',opacity:0.4,textTransform:'uppercase',letterSpacing:'0.08em'}}>On Pitch</div>
                {ms.activePlayers[k].map((name,i)=>{
                  const p=team.players.find(x=>x.name===name);
                  return p?<PlayerRow key={i} player={p} stats={ms.playerStats} isActive={true} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName} onSelect={setSelectedPlayer}/>:null;
                })}
                <div style={{padding:'4px 16px',fontSize:'10px',opacity:0.4,textTransform:'uppercase',letterSpacing:'0.08em',marginTop:'8px'}}>Bench</div>
                {team.players.filter(p=>!ms.activePlayers[k].includes(p.name)).sort((a,b)=>POS_ORDER[a.position]-POS_ORDER[b.position]).map((p,i)=>(
                  <PlayerRow key={i} player={p} stats={ms.playerStats} isActive={false} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName} onSelect={setSelectedPlayer}/>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
      {/* ── Halftime report modal ──────────────────────────────────────────── */}
      {/* Full-screen overlay rendered when the simulation reaches 45' and
          stoppage time expires.  Shows the score, key events, manager quotes,
          and a betting panel for the second half.  Cleared by startSecondHalf. */}
      {htReport&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',backgroundColor:'rgba(0,0,0,0.92)'}}>
          <div style={{width:'100%',maxWidth:'512px',border:`1px solid ${C.purple}`,backgroundColor:C.ash,overflow:'hidden'}}>

            {/* Score header */}
            <div style={{padding:'12px',textAlign:'center',borderBottom:`1px solid ${C.purple}`}}>
              <div style={{fontSize:'11px',marginBottom:'4px',color:C.purple,opacity:0.7}}>⏸ HALF TIME</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'24px'}}>
                <div style={{fontSize:'18px',fontWeight:700,color:htReport.homeTeam.color}}>{htReport.homeTeam.shortName}</div>
                <div style={{fontSize:'48px',fontWeight:700}}>{htReport.score[0]} – {htReport.score[1]}</div>
                <div style={{fontSize:'18px',fontWeight:700,color:htReport.awayTeam.color}}>{htReport.awayTeam.shortName}</div>
              </div>
            </div>

            <div style={{padding:'12px',overflowY:'auto',maxHeight:'80vh'}}>

              {/* Stats row: goals / shots / cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',marginBottom:'12px',textAlign:'center',fontSize:'11px'}}>
                {[['GOALS',htReport.goals.length],['SHOTS',htReport.shots],['CARDS',htReport.cards.length]].map(([l,v])=>(
                  <div key={l} style={{padding:'8px',border:`1px solid rgba(227,224,213,0.2)`,backgroundColor:C.abyss}}>
                    <div style={{opacity:0.6}}>{l}</div>
                    <div style={{fontWeight:700,fontSize:'18px'}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Goal log */}
              {htReport.goals.length>0&&(
                <div style={{marginBottom:'12px'}}>
                  {htReport.goals.map((g,i)=>(
                    <div key={i} style={{display:'flex',gap:'8px',fontSize:'11px',padding:'4px 0',borderBottom:`1px solid rgba(227,224,213,0.1)`}}>
                      <span style={{color:C.purple}}>{g.minute}'</span>
                      <span style={{fontWeight:700}}>{g.player}</span>
                      <span style={{opacity:0.5}}>{g.team}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Manager quotes */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                {[[C.red,htReport.homeManager,htLlmQuotes?.home||htReport.homeQuote,!htLlmQuotes?.home&&agentSystemRef.current],
                  [C.purple,htReport.awayManager,htLlmQuotes?.away||htReport.awayQuote,!htLlmQuotes?.away&&agentSystemRef.current]
                ].map(([col,name,quote,isLoading])=>(
                  <div key={name} style={{padding:'8px',border:`1px solid ${col}`,backgroundColor:C.abyss}}>
                    <div style={{fontSize:'11px',fontWeight:700,marginBottom:'4px',display:'flex',alignItems:'center',gap:'4px',color:col}}>
                      🎙️ {name}
                      {agentSystemRef.current&&<span style={{opacity:0.5,fontSize:'9px'}}>AI</span>}
                    </div>
                    {isLoading
                      ?<div style={{fontSize:'11px',opacity:0.4}}>Generating...</div>
                      :<div style={{fontSize:'11px',fontStyle:'italic',opacity:0.8}}>"{quote}"</div>}
                  </div>
                ))}
              </div>

              {/* Betting panel */}
              <div style={{fontSize:'11px',fontWeight:700,marginBottom:'8px',color:'#FFA500'}}>⚡ IN-PLAY BETS</div>
              <div style={{display:'flex',gap:'8px',alignItems:'center',fontSize:'11px',marginBottom:'8px'}}>
                <span style={{opacity:0.7}}>Stake:</span>
                <input
                  type="number"
                  value={betAmount}
                  onChange={e=>setBetAmount(Math.max(0,Math.min(credits,parseInt(e.target.value)||0)))}
                  style={{
                    width:'80px',padding:'4px',textAlign:'center',border:`1px solid ${C.dust}`,
                    fontWeight:700,fontFamily:"'Space Mono',monospace",
                    backgroundColor:C.abyss,color:C.dust,
                  }}
                />
                <span style={{color:C.purple}}>{credits} coins</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'6px',marginBottom:'8px'}}>
                <BetBtn type="homeWin" odds={odds.homeWin} label={matchState.homeTeam.shortName+' WIN'} color={C.red} placeBet={placeBet} betAmount={betAmount}/>
                <BetBtn type="draw"    odds={odds.draw}    label="DRAW"                                               placeBet={placeBet} betAmount={betAmount}/>
                <BetBtn type="awayWin" odds={odds.awayWin} label={matchState.awayTeam.shortName+' WIN'}               placeBet={placeBet} betAmount={betAmount}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',marginBottom:'12px'}}>
                <BetBtn type="btts"   odds="1.75" label="BTTS YES"  placeBet={placeBet} betAmount={betAmount}/>
                <BetBtn type="over25" odds="1.85" label="OVER 2.5"  placeBet={placeBet} betAmount={betAmount}/>
              </div>

              {currentBets.length>0&&(
                <div style={{fontSize:'11px',marginBottom:'8px',textAlign:'center',color:C.purple}}>
                  {currentBets.length} wager{currentBets.length>1?'s':''} placed ✅
                </div>
              )}

              <button
                onClick={startSecondHalf}
                style={{
                  width:'100%',padding:'12px',fontWeight:700,
                  border:`1px solid ${C.purple}`,fontFamily:"'Space Mono',monospace",
                  fontSize:'13px',letterSpacing:'0.08em',cursor:'pointer',
                  backgroundColor:C.purple,color:C.abyss,
                }}
              >
                ▶ KICK OFF — SECOND HALF
              </button>
            </div>
          </div>
        </div>
      )}

      <PlayerCard sp={selectedPlayer} events={ms.events} onClose={()=>setSelectedPlayer(null)}/>
      {showApiKeyModal&&<ApiKeyModal apiKey={apiKey} setApiKey={setApiKey} setShowApiKeyModal={setShowApiKeyModal}/>}

      <style>{`
        @keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
      `}</style>
    </div>
  );
};

export default MatchSimulator;
