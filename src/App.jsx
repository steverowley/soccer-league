import { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw, Settings } from "lucide-react";
import TEAMS from "./teams.js";
import { AgentSystem, COMMENTATOR_PROFILES } from "./agents.js";
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

const MatchSimulator = () => {
  const initState=()=>({
    minute:0,score:[0,0],possession:[50,50],momentum:[0,0],
    events:[],isPlaying:false,
    homeTeam:TEAMS.mars,awayTeam:TEAMS.saturn,
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
  const lastEventCountRef=useRef(0);
  const lastThoughtsCountRef=useRef(0);

  useEffect(()=>{if(evtLogRef.current)evtLogRef.current.scrollTop=0;},[commentaryFeed]);
  useEffect(()=>{return()=>{clearInterval(intervalRef.current);clearTimeout(toastRef.current);};},[]);
  useEffect(()=>{if(matchState.isPlaying){clearInterval(intervalRef.current);intervalRef.current=setInterval(simulateMinute,speed);}},[speed,matchState.isPlaying]);

  // Route a single LLM result to the correct feed
  const routeAgentResult=(r)=>{
    if(!r)return;
    if(r.type==='commentator'||r.type==='referee'){
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

  // Agent event processing: watch for new events, trigger LLM or route fallback
  useEffect(()=>{
    if(!matchState.events.length)return;
    const newEvents=matchState.events.slice(lastEventCountRef.current);
    lastEventCountRef.current=matchState.events.length;
    const sys=agentSystemRef.current;
    const allAgents=aiManager?[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents]:[];
    const gameState={minute:matchState.minute,score:matchState.score};
    for(const event of newEvents){
      if(!event)continue;
      if(sys){
        sys.queueEvent(event,gameState,allAgents).then(results=>{results.forEach(routeAgentResult);});
      }else{
        routeFallbackEvent(event,matchState.homeTeam.shortName);
      }
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
        const TUNNEL_Q=[
          ['We need more desire out there. Leave everything on that pitch.',"The numbers don\u2019t lie. Adjust and execute.","I\u2019ve seen worse. Fix the shape."],
          ["Tactically we\u2019re sound. Just need that final ball.",'Patience. The goal is coming.',"Keep the faith. We\u2019ve been here before."]
        ];
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
          const hs=aim.managerTacticalShout(true,newMin,prev.score[0]-prev.score[1]);
          if(hs)interventions.push({minute:newMin,commentary:`📣 ${hs.commentary}`,team:prev.homeTeam.shortName,type:'manager_shout',momentumChange:[0,0]});
          const as=aim.managerTacticalShout(false,newMin,prev.score[1]-prev.score[0]);
          if(as)interventions.push({minute:newMin,commentary:`📣 ${as.commentary}`,team:prev.awayTeam.shortName,type:'manager_shout',momentumChange:[0,0]});
          // Captain rally: losing captain lifts the team
          const hDiff=prev.score[0]-prev.score[1];
          const homeCpt=aim.activeHomeAgents.find(a=>a.isCaptain);
          const awayCpt=aim.activeAwayAgents.find(a=>a.isCaptain);
          if(hDiff<0&&hDiff>=-2&&homeCpt&&homeCpt.morale>55&&Math.random()<0.06){
            homeCpt.updateConfidence(6);
            aim.activeHomeAgents.forEach(a=>a.updateConfidence(3));
            interventions.push({minute:newMin,type:'captain_rally',team:prev.homeTeam.shortName,player:homeCpt.player.name,
              commentary:pick([`🦁 ${homeCpt.player.name} ROARS at his teammates! "WE FIGHT UNTIL THE END!"`,`💪 Captain ${homeCpt.player.name} goes player to player — this team is NOT done.`,`🔥 ${homeCpt.player.name} leads from the front. You can see the team lift.`]),
              momentumChange:[4,0]});
          }
          if(hDiff>0&&hDiff<=2&&awayCpt&&awayCpt.morale>55&&Math.random()<0.06){
            awayCpt.updateConfidence(6);
            aim.activeAwayAgents.forEach(a=>a.updateConfidence(3));
            interventions.push({minute:newMin,type:'captain_rally',team:prev.awayTeam.shortName,player:awayCpt.player.name,
              commentary:pick([`🦁 ${awayCpt.player.name} demands MORE from his side! Not giving up!`,`💪 ${awayCpt.player.name} — the captain's armband means everything right now.`,`🔥 ${awayCpt.player.name} grabs the team by the collar. Push!`]),
              momentumChange:[0,4]});
          }
          // Desperate manager substitution
          if(aim.homeManager.emotion===MGER_EMO.DESP&&prev.substitutionsUsed.home<3&&Math.random()<0.12){
            const mostTired=aim.activeHomeAgents.filter(a=>a.player.position!=='GK'&&!prev.playerStats[a.player.name]?.redCard).sort((a,b)=>b.fatigue-a.fatigue)[0];
            if(mostTired){
              const sub=makeSub(prev.homeTeam,mostTired.player.name,prev.activePlayers.home,prev.substitutionsUsed.home,prev.playerStats);
              if(sub.substitute){
                newActive.home=sub.newActive;newSubsUsed.home=(newSubsUsed.home||0)+1;
                aim.handleSubstitution(mostTired.player.name,sub.substitute,true);
                newStats[sub.substitute]={...newStats[sub.substitute],subbedOnMinute:newMin,subbedOn:true};
                interventions.push({minute:newMin,type:'desperate_sub',team:prev.homeTeam.shortName,player:sub.substitute,
                  commentary:pick([`🔄 ${aim.homeManager.name} MUST CHANGE THIS — ${mostTired.player.name} off, ${sub.substitute} ON!`,`🔄 Tactical emergency from ${aim.homeManager.name}! ${sub.substitute} thrown into the fire!`]),
                  momentumChange:[3,0]});
              }
            }
          }
          if(aim.awayManager.emotion===MGER_EMO.DESP&&prev.substitutionsUsed.away<3&&Math.random()<0.12){
            const mostTired=aim.activeAwayAgents.filter(a=>a.player.position!=='GK'&&!prev.playerStats[a.player.name]?.redCard).sort((a,b)=>b.fatigue-a.fatigue)[0];
            if(mostTired){
              const sub=makeSub(prev.awayTeam,mostTired.player.name,prev.activePlayers.away,prev.substitutionsUsed.away,prev.playerStats);
              if(sub.substitute){
                newActive.away=sub.newActive;newSubsUsed.away=(newSubsUsed.away||0)+1;
                aim.handleSubstitution(mostTired.player.name,sub.substitute,false);
                newStats[sub.substitute]={...newStats[sub.substitute],subbedOnMinute:newMin,subbedOn:true};
                interventions.push({minute:newMin,type:'desperate_sub',team:prev.awayTeam.shortName,player:sub.substitute,
                  commentary:pick([`🔄 ${aim.awayManager.name} MUST CHANGE THIS — ${mostTired.player.name} off, ${sub.substitute} ON!`,`🔄 Tactical emergency from ${aim.awayManager.name}! ${sub.substitute} thrown into the fire!`]),
                  momentumChange:[0,3]});
              }
            }
          }
          // Late-game siege (min 85+, losing team throws everyone forward)
          const hasSiege=prev.events.slice(-25).some(e=>e.type==='siege_start');
          if(!hasSiege){
            const hDiff=prev.score[0]-prev.score[1];
            if(newMin>=85&&hDiff<0&&Math.random()<0.22){
              const clutchH=aim.activeHomeAgents.find(a=>a.isClutch)?.player.name||aim.activeHomeAgents[0]?.player.name||'The captain';
              const sSeq=genSiegeSeq(newMin,prev.homeTeam.shortName,prev.awayTeam.shortName,clutchH);
              interventions=[...interventions,...sSeq.sequence];
              aim.activeHomeAgents.forEach(a=>a.updateConfidence(5));
            }
            if(newMin>=85&&hDiff>0&&Math.random()<0.22){
              const clutchA=aim.activeAwayAgents.find(a=>a.isClutch)?.player.name||aim.activeAwayAgents[0]?.player.name||'The captain';
              const sSeq=genSiegeSeq(newMin,prev.awayTeam.shortName,prev.homeTeam.shortName,clutchA);
              interventions=[...interventions,...sSeq.sequence];
              aim.activeAwayAgents.forEach(a=>a.updateConfidence(5));
            }
          }
          // Manager sent off
          if(!prev.managerSentOff?.home&&aim.homeManager.emotion===MGER_EMO.ANG&&Math.random()<0.05){
            const mSeq=genManagerSentOffSeq(newMin,aim.homeManager.name,aim.referee.name,prev.homeTeam.shortName);
            interventions=[...interventions,...mSeq.sequence];
            newManagerSentOff.home=true;
            aim.activeHomeAgents.forEach(a=>a.updateConfidence(-4));
          }
          if(!prev.managerSentOff?.away&&aim.awayManager.emotion===MGER_EMO.ANG&&Math.random()<0.05){
            const mSeq=genManagerSentOffSeq(newMin,aim.awayManager.name,aim.referee.name,prev.awayTeam.shortName);
            interventions=[...interventions,...mSeq.sequence];
            newManagerSentOff.away=true;
            aim.activeAwayAgents.forEach(a=>a.updateConfidence(-4));
          }
        }
        aim.updateManagerEmotion({},prev.score[0],prev.score[1]);
      }
      const chaosLevel=(()=>{let c=0;const diff=Math.abs(prev.score[0]-prev.score[1]);if(diff===0)c+=30;else if(diff===1)c+=20;if(newMin>80)c+=25;else if(newMin>70)c+=15;c+=prev.events.filter(e=>e.cardType).length*8;c+=(prev.redCards.home||0)*20+(prev.redCards.away||0)*20;return Math.min(100,c);})();
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
      const newScore=[...prev.score];
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
      // Build allEvents with all sequence types
      let allEvents=[...prev.events,...interventions];
      if(event.penaltySequence){const{penaltySequence,...penEvt}=event;allEvents=[...allEvents,...penaltySequence,penEvt];}
      else if(event.freekickSequence){const{freekickSequence,...fkEvt}=event;allEvents=[...allEvents,...freekickSequence,fkEvt];}
      else if(event.counterSequence){const{counterSequence,...finalEvt}=event;allEvents=[...allEvents,...counterSequence,finalEvt];}
      else if(event.confrontationSequence){const{confrontationSequence,...baseEvt}=event;allEvents=[...allEvents,baseEvt,...confrontationSequence];}
      else if(event.nearMissSequence){const{nearMissSequence,...nmEvt}=event;allEvents=[...allEvents,...nearMissSequence,nmEvt];}
      else{allEvents=[...allEvents,event];}
      // Post-goal: VAR + celebration + comeback + hat trick + sub impact
      let varOverturned=false;
      if(event.isGoal&&aim){
        const isHome=event.team===prev.homeTeam.shortName;
        const mgr=isHome?aim.homeManager:aim.awayManager;
        const prevDiff=isHome?(prev.score[0]-prev.score[1]):(prev.score[1]-prev.score[0]);
        // VAR review (8% of goals)
        if(Math.random()<0.08){
          const overturned=Math.random()<0.30;
          const vSeq=genVARSeq(newMin,event.player,event.team,aim.referee,overturned);
          allEvents=[...allEvents,...vSeq.sequence];
          if(overturned){if(isHome)newScore[0]--;else newScore[1]--;varOverturned=true;}
        }
        if(!varOverturned){
          // Celebration
          const scorerAgent=aim?.getAgentByName(event.player);
          const celebSeq=genCelebrationSeq(newMin,event.player,event.team,mgr?.name,mgr?.emotion,scorerAgent);
          allEvents=[...allEvents,...celebSeq.sequence];
          // Comeback (equaliser or lead after 2+ down)
          const newDiff=isHome?(newScore[0]-newScore[1]):(newScore[1]-newScore[0]);
          if(newDiff>=0&&prevDiff<=-2){
            const cptAgent=(isHome?aim.activeHomeAgents:aim.activeAwayAgents).find(a=>a.isCaptain);
            const cbSeq=genComebackSeq(newMin,event.player,cptAgent?.player?.name,event.team);
            allEvents=[...allEvents,...cbSeq.sequence];
            (isHome?aim.activeHomeAgents:aim.activeAwayAgents).forEach(a=>a.updateConfidence(8));
          }
          // Hat trick
          if((newStats[event.player]?.goals||0)===3){
            allEvents=[...allEvents,{minute:newMin,type:'hat_trick',team:event.team,player:event.player,
              commentary:pick([`🎩 HAT TRICK! ${event.player} completes the treble! HISTORY!`,`🎩 THREE GOALS for ${event.player}! Legendary performance!`,`🎩 ${event.player} has his HAT TRICK! This is extraordinary!`]),momentumChange:[0,0]}];
            (isHome?aim.activeHomeAgents:aim.activeAwayAgents).forEach(a=>a.updateConfidence(6));
          }
          // Sub impact (scored within 10 mins of coming on)
          const subbedMin=newStats[event.player]?.subbedOnMinute;
          if(subbedMin&&newMin-subbedMin<=10){
            allEvents=[...allEvents,{minute:newMin,type:'sub_impact',team:event.team,player:event.player,
              commentary:pick([`⚡ ${event.player} — on for just ${newMin-subbedMin} minutes and ALREADY on the scoresheet!`,`⚡ IMPACT SUBSTITUTION! ${event.player} proves the manager RIGHT immediately!`,`⚡ Off the bench and straight into the history books! ${event.player}!`]),momentumChange:[0,0]}];
          }
        }
      }
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
      agentSystemRef.current=new AgentSystem(apiKey,{
        homeTeam:matchState.homeTeam,awayTeam:matchState.awayTeam,
        referee:mgr.referee,homeManager:mgr.homeManager,awayManager:mgr.awayManager,
        homeTactics:mgr.homeTactics,awayTactics:mgr.awayTactics,
        stadium:mgr.stadium,weather:mgr.weather
      });
    }
    setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
    setShowBetting(false);
  };
  const pauseMatch=()=>{clearInterval(intervalRef.current);setMatchState(p=>({...p,isPlaying:false}));};
  const resumeMatch=()=>{if(matchState.minute<90||matchState.inStoppageTime){setMatchState(p=>({...p,isPlaying:true,isPaused:false}));intervalRef.current=setInterval(simulateMinute,speed);}};
  const resetMatch=()=>{clearInterval(intervalRef.current);aiRef.current=null;agentSystemRef.current=null;lastEventCountRef.current=0;lastThoughtsCountRef.current=0;setAiManager(null);setMatchState(initState());setShowBetting(true);setCurrentBets([]);betsRef.current=[];setBetAmount(100);setBetResult(null);setHtReport(null);setSelectedPlayer(null);setCommentaryFeed([]);setHomeManagerFeed([]);setAwayManagerFeed([]);setHomeThoughtsFeed([]);setAwayThoughtsFeed([]);setHtLlmQuotes(null);};

  const getOdds=()=>{
    const hStats=teamStats(matchState.homeTeam,matchState.activePlayers.home);
    const aStats=teamStats(matchState.awayTeam,matchState.activePlayers.away);
    const hStr=(hStats.attacking+hStats.technical)/2,aStr=(aStats.attacking+aStats.technical)/2;
    const total=hStr+aStr;
    const hWinProb=hStr/total*0.65,aWinProb=aStr/total*0.65,drawProb=1-hWinProb-aWinProb;
    return{homeWin:Math.max(1.2,(1/hWinProb*0.88)).toFixed(2),draw:Math.max(1.5,(1/drawProb*0.88)).toFixed(2),awayWin:Math.max(1.2,(1/aWinProb*0.88)).toFixed(2)};
  };
  const betLabel=(type,ms)=>{
    if(type==='homeWin') return ms.homeTeam.shortName+' Win';
    if(type==='awayWin') return ms.awayTeam.shortName+' Win';
    if(type==='draw') return 'Draw';
    if(type==='over25') return 'Over 2.5 Goals';
    if(type==='under25') return 'Under 2.5 Goals';
    if(type==='redCard') return 'Red Card Shown';
    if(type==='btts') return 'Both Teams Score';
    if(type==='nobtts') return 'Clean Sheet (1 team)';
    if(type&&type.startsWith('score_')) return 'Exact Score '+type.replace('score_','').replace('_','-');
    if(type&&type.startsWith('scorer_')) return 'First Scorer: '+type.replace('scorer_','');
    return type;
  };
  const betStatus=(bet,ms)=>{
    const [h,a]=ms.score;const total=h+a;const hadRed=ms.redCards.home>0||ms.redCards.away>0;
    if(bet.type==='homeWin') return h>a?'winning':h<a?'losing':'pending';
    if(bet.type==='awayWin') return a>h?'winning':a<h?'losing':'pending';
    if(bet.type==='draw') return h===a?'winning':'losing';
    if(bet.type==='over25') return total>=3?'winning':total<3&&ms.minute>85?'losing':'pending';
    if(bet.type==='under25') return total<3?'winning':total>=3?'losing':'pending';
    if(bet.type==='redCard') return hadRed?'winning':ms.minute>85?'losing':'pending';
    if(bet.type==='btts') return (h>0&&a>0)?'winning':ms.minute>85?'losing':'pending';
    if(bet.type==='nobtts') return (h===0||a===0)?'winning':(h>0&&a>0)?'losing':'pending';
    if(bet.type&&bet.type.startsWith('score_')){const[sh,sa]=bet.type.replace('score_','').split('_').map(Number);return(h===sh&&a===sa)?'winning':ms.minute>85?'losing':'pending';}
    if(bet.type&&bet.type.startsWith('scorer_')){const name=bet.type.replace('scorer_','');const firstGoal=ms.events.find(e=>e.isGoal);return firstGoal?(firstGoal.player===name?'winning':'losing'):'pending';}
    return 'pending';
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

  const getScoreOdds=(h,a)=>{
    const base={[`score_0_0`]:8,[`score_1_0`]:4.5,[`score_0_1`]:4.5,[`score_1_1`]:3.5,[`score_2_0`]:7,[`score_0_2`]:7,[`score_2_1`]:6,[`score_1_2`]:6,[`score_2_2`]:10,[`score_3_0`]:14,[`score_0_3`]:14,[`score_3_1`]:12,[`score_1_3`]:12};
    return base[`score_${h}_${a}`]||15;
  };
  const getScorerOdds=(player)=>{
    const base=player.attacking||70;
    return Math.max(2.5,(120-base)/10).toFixed(1);
  };
  const chaos=()=>{
    let c=0;
    const diff=Math.abs(matchState.score[0]-matchState.score[1]);
    if(diff===0)c+=30;else if(diff===1)c+=20;
    if(matchState.minute>80)c+=25;else if(matchState.minute>70)c+=15;
    c+=matchState.events.filter(e=>e.cardType).length*8;
    c+=(matchState.redCards.home||0)*20+(matchState.redCards.away||0)*20;
    if(aiManager){const angry=[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents].filter(a=>a.emotion==='ecstatic'||a.emotion==='anxious').length;c+=angry*5;}
    return Math.min(100,c);
  };

  const Stat=({label,a,b,color})=>(
    <div style={bdr(C.dust)}>
      <div className="text-xs text-center py-1" style={{opacity:0.6}}>{label}</div>
      <div className="flex items-center gap-1 px-2 pb-2">
        <span className="text-sm font-bold" style={{color:matchState.homeTeam.color}}>{a}</span>
        <div className="flex-1 h-1.5" style={{backgroundColor:C.abyss}}>
          <div className="h-full" style={{width:`${typeof a==='number'?a:50}%`,backgroundColor:matchState.homeTeam.color}}/>
        </div>
        <span className="text-sm font-bold" style={{color:matchState.awayTeam.color}}>{b}</span>
      </div>
    </div>
  );

  const PlayerRow=({player,stats,isActive,teamColor,agents,isHome,teamName})=>{
    const s=stats[player.name]||{};
    const agent=agents?.find(a=>a.player.name===player.name);
    const emo=agent?.emotion;
    return(
      <div className="flex items-center justify-between p-1.5 border mb-1" onClick={()=>isActive&&setSelectedPlayer({player,agent,stats:s,teamColor,teamName})} style={{borderColor:C.dust,backgroundColor:C.abyss,opacity:isActive?1:0.5,cursor:isActive?'pointer':'default'}}>
        <div className="flex-1">
          <div className="text-xs font-bold flex items-center gap-1" style={{color:isActive?teamColor:undefined}}>
            {s.subbedOn?'🔺 ':''}{player.name}{PERS_ICON[agent?.personality]?<span className="opacity-60">{PERS_ICON[agent.personality]}</span>:null}
          </div>
          <div className="text-xs flex gap-2" style={{opacity:0.6}}>
            <span>{player.position}</span>
            {agent&&<span>😊{Math.round(agent.confidence)}% 💨{Math.round(agent.fatigue)}%</span>}
            {emo&&emo!=='neutral'&&<span style={{color:C.purple}}>{emo}</span>}
          </div>
        </div>
        <div className="flex gap-1 text-sm">
          {s.goals>0&&<span>⚽{s.goals}</span>}
          {s.assists>0&&<span>👟{s.assists}</span>}
          {s.saves>0&&<span>✋{s.saves}</span>}
          {s.yellowCard&&<span>🟨</span>}
          {s.redCard&&<span>🟥</span>}
          {s.injured&&<span>🏥</span>}
        </div>
      </div>
    );
  };

  const FeedCard=({item,isThought})=>(
    <div className="p-2 border-l-2 mb-2" style={{borderColor:isThought?C.red:C.purple,backgroundColor:C.abyss}}>
      <div className="flex items-center gap-2 mb-1">
        {isThought?<span className="text-lg">{item.emoji}</span>:<span className="text-xs font-bold" style={{color:C.purple}}>{item.user}</span>}
        <span className="text-xs" style={{opacity:0.5}}>{item.minute}'</span>
      </div>
      {isThought&&<span className="text-xs font-bold">{item.player}</span>}
      <div className="text-xs italic mt-1" style={{opacity:0.85}}>"{item.text}"</div>
      {!isThought&&<div className="text-xs mt-1" style={{opacity:0.5}}>♥️{item.likes} 🔁{item.retweets}</div>}
    </div>
  );

  const AgentCard=({item})=>{
    const borderColor=item.type==='commentator'?item.color:item.type==='player_thought'?item.color:item.type==='manager'?item.color:item.type==='referee'?'#FFD700':C.purple;
    const label=item.type==='commentator'?`${item.name} • ${item.role}`:item.type==='player_thought'?`${item.name} (inner thought)`:item.type==='manager'?`${item.name}`:item.type==='referee'?`${item.name} • Referee`:'Agent';
    return(
      <div className="p-2 border-l-2 mb-2" style={{borderColor,backgroundColor:C.abyss}}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">{item.emoji}</span>
          <span className="text-xs font-bold" style={{color:borderColor}}>{label}</span>
          <span className="text-xs ml-auto" style={{opacity:0.4}}>{item.minute}'</span>
        </div>
        <div className="text-xs italic" style={{opacity:0.9}}>"{item.text}"</div>
      </div>
    );
  };

  const ApiKeyModal=()=>{
    const [draft,setDraft]=useState(apiKey);
    const [testing,setTesting]=useState(false);
    const [testResult,setTestResult]=useState(null);
    const save=()=>{
      localStorage.setItem('isi_api_key',draft);
      setApiKey(draft);
      setShowApiKeyModal(false);
    };
    const test=async()=>{
      setTesting(true);setTestResult(null);
      try{
        const {default:Anthropic}=await import('@anthropic-ai/sdk');
        const client=new Anthropic({apiKey:draft,dangerouslyAllowBrowser:true});
        await client.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:5,messages:[{role:'user',content:'hi'}]});
        setTestResult('✅ Connected!');
      }catch(e){
        const msg=e?.message||String(e);
        console.error('API test error:',e);
        if(msg.includes('401')||msg.toLowerCase().includes('authentication')||msg.toLowerCase().includes('api key'))setTestResult('❌ Invalid key — check console.anthropic.com');
        else if(msg.includes('403'))setTestResult('❌ Permission denied — check key permissions');
        else setTestResult('❌ '+msg);
      }
      setTesting(false);
    };
    return(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.92)'}}>
        <div className="w-full max-w-md border p-6" style={{...bdr(C.purple,C.ash)}}>
          <h2 className="text-xl font-bold mb-1" style={{color:C.purple}}>⚙️ AGENT CONFIGURATION</h2>
          <p className="text-xs mb-4" style={{opacity:0.6}}>Paste your Anthropic API key to enable LLM-powered agents. Your key is stored in <code>localStorage</code> and never leaves your browser.</p>
          <div className="mb-3">
            <label className="text-xs font-bold mb-1 block" style={{color:C.purple}}>ANTHROPIC API KEY</label>
            <input type="password" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="sk-ant-..." className="w-full p-3 border text-sm font-mono" style={{backgroundColor:C.abyss,borderColor:C.dust,color:C.dust}}/>
          </div>
          <div className="flex gap-2 mb-1">
            <button onClick={test} disabled={testing||!draft} className="px-4 py-2 border text-sm" style={bdr(C.dust,C.abyss)}>{testing?'Testing...':'Test Key'}</button>
          </div>
          {testResult&&<div className="mb-3 p-2 border text-xs font-mono break-all" style={{borderColor:testResult.startsWith('✅')?'#00cc66':C.red,color:testResult.startsWith('✅')?'#00cc66':C.red,backgroundColor:C.abyss}}>{testResult}</div>}
          <div className="mb-4 p-3 border text-xs" style={bdr(C.dust,C.abyss)}>
            <div className="font-bold mb-2" style={{color:C.purple}}>ACTIVE AGENTS</div>
            {COMMENTATOR_PROFILES.map(p=>(
              <div key={p.id} className="flex items-center gap-2 mb-1">
                <span>{p.emoji}</span><span style={{color:p.color}}>{p.name}</span><span style={{opacity:0.5}}>— {p.role}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 mb-1"><span>🧑‍💼</span><span>Managers</span><span style={{opacity:0.5}}>— Touchline reactions</span></div>
            <div className="flex items-center gap-2 mb-1"><span>⚖️</span><span>Referee</span><span style={{opacity:0.5}}>— Decision explanations</span></div>
            <div className="flex items-center gap-2"><span>💭</span><span>Players</span><span style={{opacity:0.5}}>— Inner monologue</span></div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={!draft} className="flex-1 py-2 font-bold border" style={{backgroundColor:C.purple,color:C.abyss,borderColor:C.purple}}>SAVE &amp; ENABLE AGENTS</button>
            <button onClick={()=>setShowApiKeyModal(false)} className="px-4 py-2 border" style={bdr(C.dust,C.abyss)}>CANCEL</button>
          </div>
          {apiKey&&<button onClick={()=>{localStorage.removeItem('isi_api_key');setApiKey('');setShowApiKeyModal(false);}} className="mt-2 w-full py-1 text-xs border" style={{borderColor:C.red,color:C.red,backgroundColor:C.abyss}}>CLEAR KEY &amp; DISABLE AGENTS</button>}
        </div>
      </div>
    );
  };

  const BetBtn=({type,odds,label,sub,color=C.purple})=>(
    <button onClick={()=>placeBet(type,betAmount,odds)} disabled={betAmount<=0}
      className="p-3 border w-full" style={{...bdr(color,C.abyss),opacity:betAmount<=0?0.5:1,cursor:betAmount<=0?'not-allowed':'pointer'}}>
      <div className="text-xs mb-1" style={{opacity:0.7}}>{label}</div>
      {sub&&<div className="text-xs mb-1" style={{opacity:0.5}}>{sub}</div>}
      <div className="text-2xl font-bold" style={{color}}>{odds}x</div>
      <div className="text-xs mt-1" style={{opacity:0.6}}>Win: {Math.floor(betAmount*parseFloat(odds))} coins</div>
    </button>
  );

  const PlayerCard=({sp})=>{
    if(!sp) return null;
    const {player,agent,stats,teamColor,teamName}=sp;
    const s=stats||{};
    const evts=matchState.events.filter(e=>e.player===player.name||e.assister===player.name);
    const DESC={[PERS.SEL]:"Glory hunter. Shoots from everywhere, passes to nobody.",[PERS.TEAM]:"The glue. Always finds the open man.",[PERS.AGG]:"Leaves a mark — on opponents and the ref.",[PERS.CAU]:"Reads the game. Never panics, rarely impresses.",[PERS.CRE]:"Unpredictable genius or costly showboat.",[PERS.LAZ]:"Tremendous talent. Questionable work rate.",[PERS.WRK]:"Will run through a wall. Then run through it again.",[PERS.BAL]:"Solid. Dependable. Forgettable in the best way."};
    return(
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.85)'}} onClick={()=>setSelectedPlayer(null)}>
        <div className="w-full max-w-sm border" style={bdr(teamColor,C.ash)} onClick={e=>e.stopPropagation()}>
          <div className="p-3 border-b flex items-center justify-between" style={{borderColor:teamColor}}>
            <div><div className="text-xl font-bold" style={{color:teamColor}}>{player.name}</div>
              <div className="text-xs" style={{opacity:0.6}}>{player.position} &bull; {teamName} {PERS_ICON[agent?.personality]||''}</div>
            </div>
            <button onClick={()=>setSelectedPlayer(null)} style={{opacity:0.5,fontSize:18}}>&#x2715;</button>
          </div>
          <div className="p-3">
            {agent&&<div className="mb-3 p-2 border-l-4 text-xs italic" style={{borderColor:teamColor,backgroundColor:teamColor+'22'}}>"{DESC[agent.personality]||'Plays the game.'}"</div>}
            <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
              <div>
                <div className="font-bold mb-2" style={{opacity:0.6}}>ATTRIBUTES</div>
                {[['ATK',player.attacking],['DEF',player.defending],['TEC',player.technical],['ATH',player.athletic],['MEN',player.mental]].map(([k,v])=>(
                  <div key={k} className="flex items-center gap-1 mb-1">
                    <span className="w-7" style={{opacity:0.6}}>{k}</span>
                    <div className="flex-1 h-1.5" style={{backgroundColor:C.abyss}}>
                      <div className="h-full" style={{width:v+'%',backgroundColor:v>80?teamColor:v>65?C.purple:C.dust}}/>
                    </div>
                    <span className="w-5 text-right">{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="font-bold mb-2" style={{opacity:0.6}}>THIS MATCH</div>
                <div className="text-xs space-y-1">
                  {s.goals>0&&<div>&#x26BD; {s.goals} goal{s.goals>1?'s':''}</div>}
                  {s.assists>0&&<div>&#x1F45F; {s.assists} assist{s.assists>1?'s':''}</div>}
                  {s.saves>0&&<div>&#x270B; {s.saves} save{s.saves>1?'s':''}</div>}
                  {s.tackles>0&&<div>&#x1F4AA; {s.tackles} tackle{s.tackles>1?'s':''}</div>}
                  {s.yellowCard&&<div>&#x1F7E8; Booked</div>}
                  {s.redCard&&<div>&#x1F7E5; Sent off</div>}
                  {s.injured&&<div>&#x1F3E5; Injured</div>}
                  {!s.goals&&!s.assists&&!s.saves&&!s.tackles&&!s.yellowCard&&<div style={{opacity:0.4}}>Quiet so far</div>}
                </div>
                {agent&&<div className="mt-2 pt-2 border-t text-xs" style={{borderColor:C.dust}}>
                  <div style={{opacity:0.6}}>Conf {Math.round(agent.confidence)}% &bull; Fatigue {Math.round(agent.fatigue)}%</div>
                  {agent.emotion!=='neutral'&&<div style={{color:teamColor}}>{agent.emotion}</div>}
                </div>}
              </div>
            </div>
            {evts.length>0&&<div className="border-t pt-2" style={{borderColor:C.dust}}>
              {evts.slice(-4).map((e,i)=><div key={i} className="text-xs py-0.5" style={{opacity:0.7}}><span style={{color:C.purple}}>{e.minute}'</span> {(e.commentary||'').slice(0,55)}</div>)}
            </div>}
          </div>
        </div>
      </div>
    );
  };
  const chaosLevel=chaos();
  const chaosColor=chaosLevel<20?C.purple:chaosLevel<40?C.dust:chaosLevel<60?'#FFA500':chaosLevel<80?C.red:'#FF0000';
  const chaosLabel=chaosLevel<20?'CALM':chaosLevel<40?'TENSE':chaosLevel<60?'HEATED':chaosLevel<80?'CHAOTIC':'MAYHEM';
  const odds=getOdds();
  const ms=matchState;

  return(
    <div className="min-h-screen p-4" style={{backgroundColor:C.abyss,color:C.dust,fontFamily:"'Space Mono',monospace",backgroundImage:`radial-gradient(1px 1px at 20px 30px,rgba(255,255,255,0.3),transparent),radial-gradient(1px 1px at 80px 80px,rgba(154,92,244,0.3),transparent),radial-gradient(2px 2px at 150px 50px,rgba(255,255,255,0.5),transparent)`,backgroundRepeat:'repeat',backgroundSize:'200px 200px'}}>

      {ms.isPaused&&ms.pauseCommentary&&(
        <div className="fixed inset-x-0 top-0 z-50 p-4 text-center text-xl font-bold border-b" style={{backgroundColor:C.ash,borderColor:C.purple,color:C.purple,animation:'fadeIn 0.3s'}}>
          {ms.pauseCommentary}
          <button onClick={resumeMatch} className="ml-4 px-4 py-1 text-sm border" style={bdr(C.dust,C.abyss)}>▶ CONTINUE</button>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-4 relative">
          <button onClick={()=>setShowApiKeyModal(true)} className="absolute right-0 top-0 p-2 border" style={bdr(apiKey?C.purple:C.dust,C.abyss)} title="Configure AI Agents">
            <Settings size={14} style={{color:apiKey?C.purple:undefined}}/>
          </button>
          <h1 className="text-2xl font-bold" style={{color:C.dust}}>INTERGALACTIC SOCCER LEAGUE</h1>
          <p className="text-xs" style={{opacity:0.6}}>MATCH SIMULATION</p>
          {aiManager&&<div className="text-xs mt-1" style={{color:C.purple}}>🤖 AI AGENTS ACTIVE{apiKey&&agentSystemRef.current?' • 🧠 LLM AGENTS LIVE':apiKey?' • 🔑 KEY SET (start match to activate)':' • ⚙️ SET API KEY FOR LLM AGENTS'}</div>}
        </div>

        {aiManager&&!showBetting&&(
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div className="p-2 border" style={bdr(C.purple)}>
              <div className="text-lg">{WX_ICON[aiManager.weather]||'🌌'}</div>
              <div className="font-bold" style={{color:C.purple}}>{aiManager.weather.replace(/_/g,' ').toUpperCase()}</div>
              <div style={{opacity:0.6}}>{aiManager.temperature}°C • {aiManager.timeOfDay}</div>
              <div className="font-bold mt-1" style={{fontSize:10,opacity:0.8}}>📍{aiManager.stadium.name}</div>
            </div>
            <div className="p-2 border" style={bdr(C.dust)}>
              <div className="text-lg">{aiManager.referee.leniency>70?'😊':aiManager.referee.leniency>40?'😐':'😠'}</div>
              <div className="font-bold">{aiManager.referee.name}</div>
              <div style={{opacity:0.6}}>{aiManager.referee.leniency>70?'🟢 Lenient':aiManager.referee.leniency>40?'🟡 Fair':'🔴 Strict'}</div>
            </div>
            <div className="p-2 border" style={bdr(C.red)}>
              <div className="text-lg">{EMO_ICON[aiManager.homeManager.emotion]||'😐'}</div>
              <div className="font-bold" style={{color:C.red}}>{aiManager.homeManager.name}</div>
              <div style={{opacity:0.6}}>{aiManager.homeFormation} • {aiManager.homeTactics.replace(/_/g,' ').toUpperCase().slice(0,10)}</div>
            </div>
            <div className="p-2 border" style={bdr(C.purple)}>
              <div className="text-lg">{EMO_ICON[aiManager.awayManager.emotion]||'😐'}</div>
              <div className="font-bold" style={{color:C.purple}}>{aiManager.awayManager.name}</div>
              <div style={{opacity:0.6}}>{aiManager.awayFormation} • {aiManager.awayTactics.replace(/_/g,' ').toUpperCase().slice(0,10)}</div>
            </div>
          </div>
        )}

        {showBetting&&credits===0&&currentBets.length===0&&(
          <div className="border p-6 text-center mb-4" style={bdr(C.red)}>
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold mb-2" style={{color:C.red}}>QUANTUM BANKRUPTCY</h3>
            <p style={{opacity:0.7}}>The Intergalactic Banking Consortium offers emergency funding.</p>
            <button onClick={()=>setCredits(100)} className="mt-4 px-6 py-2 font-bold border" style={{backgroundColor:C.purple,color:C.abyss,borderColor:C.purple}}>ACCEPT BAILOUT (+100 COINS)</button>
          </div>
        )}

        {showBetting&&(credits>0||currentBets.length>0)&&(
          <div className="border p-4 mb-4" style={bdr(C.purple)}>
            <h2 className="text-xl font-bold text-center mb-4" style={{color:C.purple}}>⚡ QUANTUM BETTING TERMINAL ⚡</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 border text-center" style={bdr(C.purple,C.abyss)}>
                <div className="text-xs mb-1" style={{opacity:0.6}}>BALANCE</div>
                <div className="text-3xl font-bold" style={{color:C.purple}}>{credits}</div>
                <div className="text-xs" style={{opacity:0.6}}>Quantum Coins</div>
              </div>
              <div className="p-3 border" style={bdr(C.dust,C.abyss)}>
                <div className="text-lg font-bold" style={{color:C.red}}>{ms.homeTeam.name}</div>
                <div className="text-xs text-center" style={{opacity:0.5}}>vs</div>
                <div className="text-lg font-bold" style={{color:C.purple}}>{ms.awayTeam.name}</div>
              </div>
            </div>
            <div className="mb-4 p-3 border" style={bdr(C.dust,C.abyss)}>
              <label className="text-sm font-bold mb-2 block" style={{color:C.purple}}>WAGER AMOUNT</label>
              <div className="flex gap-2 items-center">
                <input type="number" value={betAmount} onChange={e=>setBetAmount(Math.max(0,Math.min(credits,parseInt(e.target.value)||0)))}
                  className="flex-1 p-2 text-center text-xl font-bold border" style={{backgroundColor:C.ash,borderColor:C.dust,color:C.dust}}/>
                {[100,500].map(v=><button key={v} onClick={()=>setBetAmount(Math.min(credits,v))} className="px-3 py-2 border" style={bdr(C.dust,C.abyss)}>{v}</button>)}
                <button onClick={()=>setBetAmount(credits)} className="px-3 py-2 border font-bold" style={{borderColor:C.red,color:C.red,backgroundColor:C.abyss}}>ALL IN</button>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-sm font-bold mb-2" style={{color:C.purple}}>🏆 MATCH OUTCOME</div>
              <div className="grid grid-cols-3 gap-2">
                <BetBtn type="homeWin" odds={odds.homeWin} label={`${ms.homeTeam.shortName} WINS`} color={C.red}/>
                <BetBtn type="draw" odds={odds.draw} label="DRAW"/>
                <BetBtn type="awayWin" odds={odds.awayWin} label={`${ms.awayTeam.shortName} WINS`}/>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-sm font-bold mb-2" style={{color:C.purple}}>⚽ GOALS</div>
              <div className="grid grid-cols-2 gap-2">
                <BetBtn type="over25" odds="1.85" label="OVER 2.5 GOALS" sub="3+ goals"/>
                <BetBtn type="under25" odds="1.95" label="UNDER 2.5 GOALS" sub="0-2 goals"/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <BetBtn type="btts" odds="1.75" label="BTTS YES" sub="Both score"/>
              <BetBtn type="redCard" odds="3.5" label="RED CARD" sub="Any red" color={C.red}/>
            </div>
            <div className="mb-4">
              <div className="text-sm font-bold mb-2" style={{color:'#FFA500'}}>🎯 EXACT SCORE</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[['1-0',1,0],['0-1',0,1],['1-1',1,1],['2-1',2,1],['1-2',1,2],['2-0',2,0],['0-2',0,2],['2-2',2,2]].map(([l,h,a])=>(
                  <BetBtn key={l} type={'score_'+h+'_'+a} odds={getScoreOdds(h,a)} label={l} color='#FFA500'/>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <div className="text-sm font-bold mb-2" style={{color:'#FFD700'}}>⭐ FIRST GOALSCORER</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[...ms.homeTeam.players.filter(p=>p.starter&&p.position==='FW').slice(0,3),
                  ...ms.awayTeam.players.filter(p=>p.starter&&p.position==='FW').slice(0,3)].map(p=>{
                  const ih=ms.homeTeam.players.includes(p);
                  return <BetBtn key={p.name} type={'scorer_'+p.name} odds={getScorerOdds(p)} label={p.name} sub={p.position+' • '+(ih?ms.homeTeam.shortName:ms.awayTeam.shortName)} color={ih?C.red:C.purple}/>;
                })}
              </div>
            </div>

          </div>
        )}

        {betResult&&(
          <div className="border p-4 mb-3" style={bdr(betResult.gain>0?C.purple:C.red,C.ash)}>
            <div className="text-center mb-3">
              <div className="text-2xl font-bold">{betResult.gain>0?'🎉 YOU WON!':'💸 BETTER LUCK NEXT TIME'}</div>
              <div className="text-xs mt-1" style={{opacity:0.6}}>Final score: {betResult.finalScore[0]}–{betResult.finalScore[1]}{betResult.hadRed?' • 🟥 Red card shown':''}</div>
            </div>
            <div className="space-y-1.5 mb-3">
              {betResult.bets.map((bet,i)=>(
                <div key={i} className="flex items-center justify-between p-2 border" style={{borderColor:bet.won?'#00cc66':C.red,backgroundColor:bet.won?'#00cc6615':'#FF6B6B15'}}>
                  <div className="flex items-center gap-2">
                    <span>{bet.won?'✅':'❌'}</span>
                    <div>
                      <div className="text-xs font-bold">{betLabel(bet.type,ms)}</div>
                      <div className="text-xs" style={{opacity:0.6}}>{bet.amount} coins @ {bet.odds}x</div>
                    </div>
                  </div>
                  <div className="text-sm font-bold" style={{color:bet.won?'#00cc66':C.red}}>{bet.won?`+${bet.payout}`:`-${bet.amount}`}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2 border-t text-sm" style={{borderColor:C.dust}}>
              <span style={{opacity:0.7}}>{betResult.won}/{betResult.total} correct</span>
              <span className="font-bold" style={{color:betResult.gain>0?C.purple:C.red}}>{betResult.gain>0?'NET: +'+betResult.gain:'NET: -'+betResult.bets.reduce((s,b)=>s+b.amount,0)} coins</span>
            </div>
            <button onClick={()=>setBetResult(null)} className="mt-3 w-full px-4 py-2 border text-sm font-bold" style={bdr(C.dust,C.abyss)}>DISMISS</button>
          </div>
        )}
        {currentBets.length>0&&ms.minute>0&&(
          <div className="border p-3 mb-3" style={bdr(C.purple)}>
            <div className="text-xs font-bold mb-2" style={{color:C.purple}}>📋 LIVE WAGERS</div>
            {currentBets.map((bet,i)=>{
              const st=betStatus(bet,ms);
              const sc=st==='winning'?'#00cc66':st==='losing'?C.red:'#FFA500';
              const pot=Math.floor(bet.amount*bet.odds);
              return <div key={i} className="flex items-center justify-between py-1.5 border-b text-xs" style={{borderColor:sc}}>
                <span>{st==='winning'?'✅':st==='losing'?'❌':'⏳'} {betLabel(bet.type,ms)}</span>
                <span style={{color:sc}}>{st==='winning'?'+'+pot:st==='losing'?'-'+bet.amount:'?'+pot}</span>
              </div>;
            })}
            <div className="flex justify-between text-xs pt-1" style={{opacity:0.6}}>
              <span>Potential</span>
              <span style={{color:C.purple}}>{currentBets.filter(b=>betStatus(b,ms)==='winning').reduce((s,b)=>s+Math.floor(b.amount*b.odds),0)} coins</span>
            </div>
          </div>
        )}
        <div className="border p-4 mb-3 relative overflow-hidden" style={{...bdr(C.dust),boxShadow:`0 0 30px rgba(154,92,244,0.15)`}}>
          {ms.currentAnimation?.type==='goal'&&(
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-8xl" style={{animation:'goalPulse 2s ease-out forwards'}}>⚽</div>
            </div>
          )}
          {ms.currentAnimation?.type==='saved'&&(
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-8xl" style={{animation:'goalPulse 2s ease-out forwards'}}>✋</div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 items-center">
            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{color:ms.homeTeam.color}}>{ms.homeTeam.shortName}</div>
              <div className="text-5xl font-bold">{ms.score[0]}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold mb-1" style={{color:C.purple}}>
                {ms.inStoppageTime?`${ms.minute>=90?90:45}+${Math.max(0,(ms.minute>=90?ms.minute-90:ms.minute-45))}\'`:`${ms.minute}'`}
              </div>
              <div className="flex justify-center gap-1 mb-1">
                {[...Array(Math.min(6,Math.ceil(ms.minute/15)))].map((_,i)=><div key={i} className="w-1.5 h-1.5 rounded-full" style={{backgroundColor:C.purple}}/>)}
              </div>
              <div className="text-xs" style={{opacity:0.5}}>{ms.inStoppageTime?'STOPPAGE':ms.minute<45?'1ST HALF':ms.minute<90?'2ND HALF':'FT'}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold mb-1" style={{color:ms.awayTeam.color}}>{ms.awayTeam.shortName}</div>
              <div className="text-5xl font-bold">{ms.score[1]}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-3 flex-wrap">
          {!ms.isPlaying&&ms.minute===0&&<button onClick={startMatch} className="flex items-center gap-2 px-4 py-2 font-bold border" style={{backgroundColor:C.purple,color:C.abyss,borderColor:C.purple}}><Play size={16}/>KICK OFF</button>}
          {ms.isPlaying&&<button onClick={pauseMatch} className="flex items-center gap-2 px-4 py-2 font-bold border" style={bdr(C.dust,C.ash)}><Pause size={16}/>PAUSE</button>}
          {!ms.isPlaying&&ms.minute>0&&ms.minute<90&&!ms.mvp&&<button onClick={resumeMatch} className="flex items-center gap-2 px-4 py-2 font-bold border" style={{backgroundColor:C.purple,color:C.abyss,borderColor:C.purple}}><Play size={16}/>RESUME</button>}
          <button onClick={resetMatch} className="flex items-center gap-2 px-4 py-2 border" style={bdr(C.dust,C.ash)}><RotateCcw size={16}/>RESET</button>
          <div className="flex gap-1">
            {[['SLOW',2000],['NORMAL',1000],['FAST',500],['TURBO',200]].map(([label,spd])=>(
              <button key={spd} onClick={()=>setSpeed(spd)} className="px-3 py-2 text-xs border" style={{...bdr(speed===spd?C.purple:C.dust,speed===spd?C.purple:C.abyss),color:speed===spd?C.abyss:C.dust}}>{label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
          <div className="p-2 border text-center" style={bdr(C.dust)}>
            <div style={{opacity:0.6}}>PLAYERS</div>
            <div className="font-bold"><span style={{color:ms.activePlayers.home.length<11?C.red:C.dust}}>{ms.activePlayers.home.length}</span> v <span style={{color:ms.activePlayers.away.length<11?C.red:C.dust}}>{ms.activePlayers.away.length}</span></div>
          </div>
          <div className="p-2 border" style={bdr(C.dust)}>
            <div className="text-center" style={{opacity:0.6}}>POSSESSION</div>
            <div className="flex items-center gap-1">
              <span>{ms.possession[0].toFixed(0)}%</span>
              <div className="flex-1 h-1.5" style={{backgroundColor:C.abyss}}>
                <div className="h-full" style={{width:`${ms.possession[0]}%`,backgroundColor:ms.homeTeam.color}}/>
              </div>
              <span>{ms.possession[1].toFixed(0)}%</span>
            </div>
          </div>
          <div className="p-2 border" style={bdr(C.dust)}>
            <div className="text-center" style={{opacity:0.6}}>MOMENTUM</div>
            <div className="flex items-center gap-1">
              <span>{ms.momentum[0]>0?'+':''}{ms.momentum[0]}</span>
              <div className="flex-1 h-1.5" style={{backgroundColor:C.abyss}}>
                <div className="h-full" style={{width:`${50+ms.momentum[0]*5}%`,backgroundColor:ms.homeTeam.color}}/>
              </div>
              <span>{ms.momentum[1]>0?'+':''}{ms.momentum[1]}</span>
            </div>
          </div>
        </div>

        <div className="border mb-3 p-3" style={bdr(C.dust)}>
          <div className="text-xs font-bold mb-1" style={{color:C.red}}>⚡ CHAOS METER ⚡</div>
          <div className="flex justify-between text-xs mb-1" style={{opacity:0.6}}><span>😌 CALM</span><span style={{color:chaosColor,fontWeight:'bold'}}>{chaosLabel}</span><span>😱 MAYHEM</span></div>
          <div className="h-5 border relative" style={{backgroundColor:C.abyss,borderColor:C.dust}}>
            <div className="absolute left-0 top-0 bottom-0 transition-all" style={{width:`${chaosLevel}%`,backgroundColor:chaosColor,boxShadow:`0 0 8px ${chaosColor}`}}/>
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">{chaosLevel}%</div>
          </div>
          <div className="flex flex-wrap gap-1 mt-1 text-xs">
            {ms.minute>80&&<span className="px-2 py-0.5 rounded" style={{backgroundColor:C.red}}>⏰ LATE GAME</span>}
            {Math.abs(ms.score[0]-ms.score[1])===0&&ms.minute>30&&<span className="px-2 py-0.5 rounded" style={{backgroundColor:'#FFA500'}}>⚖️ TIED</span>}
            {(ms.redCards.home+ms.redCards.away)>0&&<span className="px-2 py-0.5 rounded" style={{backgroundColor:'#FF0000'}}>🟥 RED CARDS</span>}
          </div>
        </div>

        {/* ── 3-column live feeds ──────────────────────────────────────────────── */}
        {aiManager&&(
          <div className="grid gap-3 mb-3" style={{gridTemplateColumns:'1fr 1.4fr 1fr'}}>

            {/* ── LEFT: Home Team ─────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="border p-2" style={bdr(ms.homeTeam.color,C.ash)}>
                <div className="text-sm font-bold truncate" style={{color:ms.homeTeam.color}}>{ms.homeTeam.name}</div>
                <div className="text-xs mt-0.5" style={{opacity:0.6}}>{aiManager.homeFormation} • {aiManager.homeTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span>{EMO_ICON[aiManager.homeManager.emotion]||'😐'}</span>
                  <span className="text-xs font-bold" style={{color:ms.homeTeam.color}}>{aiManager.homeManager.name}</span>
                  <span className="text-xs ml-auto" style={{opacity:0.5}}>{ms.substitutionsUsed.home}/3 subs</span>
                </div>
              </div>
              <div className="border" style={bdr(ms.homeTeam.color)}>
                <div className="px-2 py-1.5 border-b text-xs font-bold" style={{borderColor:ms.homeTeam.color,color:ms.homeTeam.color}}>🧑‍💼 MANAGER</div>
                <div className="p-2 overflow-y-auto" style={{height:'160px',scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} ${C.abyss}`}}>
                  {homeManagerFeed.length===0
                    ?<div className="text-xs text-center py-8" style={{opacity:0.4}}>Watching from the touchline...</div>
                    :[...homeManagerFeed].reverse().map((item,i)=>(
                      <div key={i} className="mb-2 pb-1.5 border-b last:border-0" style={{borderColor:`${ms.homeTeam.color}30`}}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs font-bold" style={{color:ms.homeTeam.color}}>{item.emoji} {item.name}</span>
                          <span className="text-xs ml-auto" style={{opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div className="text-xs italic leading-relaxed" style={{opacity:0.9}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="border" style={bdr(`${ms.homeTeam.color}80`,C.abyss)}>
                <div className="px-2 py-1.5 border-b text-xs font-bold" style={{borderColor:`${ms.homeTeam.color}80`,color:ms.homeTeam.color}}>💭 PLAYER THOUGHTS</div>
                <div className="p-2 overflow-y-auto" style={{height:'220px',scrollbarWidth:'thin',scrollbarColor:`${ms.homeTeam.color} ${C.abyss}`}}>
                  {homeThoughtsFeed.length===0
                    ?<div className="text-xs text-center py-10" style={{opacity:0.4}}>Quiet minds...</div>
                    :[...homeThoughtsFeed].reverse().map((item,i)=>(
                      <div key={i} className="mb-2 pb-1.5 border-b last:border-0" style={{borderColor:`${ms.homeTeam.color}25`}}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span>{item.emoji}</span>
                          <span className="text-xs font-bold truncate" style={{color:item.color||ms.homeTeam.color}}>{item.name}</span>
                          <span className="text-xs ml-auto shrink-0" style={{opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div className="text-xs italic leading-relaxed" style={{opacity:0.85}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* ── CENTRE: Pitch + Commentary ──────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="border p-2" style={bdr(C.dust)}>
                <div className="text-xs font-bold mb-1.5 text-center" style={{color:C.purple}}>⚽ LIVE PITCH</div>
                <div className="relative border-2" style={{height:'88px',backgroundColor:'#1a4d2e',borderColor:C.dust,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(255,255,255,0.05) 19px,rgba(255,255,255,0.05) 20px)'}}>
                  <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{backgroundColor:C.dust,opacity:0.3}}/>
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full border-2" style={{borderColor:C.dust,opacity:0.3}}/>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-8 border-2 border-l-0" style={{borderColor:ms.homeTeam.color,backgroundColor:`${ms.homeTeam.color}20`}}/>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-8 border-2 border-r-0" style={{borderColor:ms.awayTeam.color,backgroundColor:`${ms.awayTeam.color}20`}}/>
                  <div className="absolute top-1/2 -translate-y-1/2 text-lg transition-all duration-1000" style={{left:`calc(${ms.possession[0]}% - 10px)`}}>⚽</div>
                  {[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents].filter(a=>a.emotion!=='neutral').slice(0,4).map((a,i)=>(
                    <div key={i} className="absolute text-xs" style={{left:`${a.isHome?8+i*10:52+i*10}%`,top:`${15+i*20}%`}}>
                      {a.emotion==='ecstatic'?'😄':a.emotion==='frustrated'?'😤':a.emotion==='anxious'?'😰':a.emotion==='proud'?'😊':'😡'}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs mt-1" style={{opacity:0.6}}>
                  <span style={{color:ms.homeTeam.color}}>{ms.homeTeam.shortName}{ms.possession[0]>55?' ⚔️':''}</span>
                  <span>{ms.possession[0]>55?'ATTACKING':ms.possession[0]<45?`${ms.awayTeam.shortName} ATTACKING`:'MIDFIELD'}</span>
                  <span style={{color:ms.awayTeam.color}}>{ms.possession[1]>55?'⚔️ ':''}{ms.awayTeam.shortName}</span>
                </div>
              </div>

              {ms.mvp&&(
                <div className="border p-2 flex items-center gap-2" style={bdr(C.purple,`${C.purple}15`)}>
                  <div className="text-2xl">⭐</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs" style={{color:C.purple}}>MATCH MVP</div>
                    <div className="text-sm font-bold truncate" style={{color:ms.mvp.teamColor}}>{ms.mvp.name}</div>
                    <div className="text-xs" style={{opacity:0.5}}>{ms.mvp.position} • {ms.mvp.team}</div>
                  </div>
                  <div className="flex gap-2 text-xs shrink-0">
                    {ms.mvp.stats.goals>0&&<span>⚽{ms.mvp.stats.goals}</span>}
                    {ms.mvp.stats.assists>0&&<span>👟{ms.mvp.stats.assists}</span>}
                    {ms.mvp.stats.saves>0&&<span>✋{ms.mvp.stats.saves}</span>}
                  </div>
                </div>
              )}

              <div className="border flex-1" style={bdr(C.purple)}>
                <div className="px-2 py-1.5 border-b flex items-center gap-2" style={{borderColor:C.purple,backgroundColor:`${C.purple}10`}}>
                  <span className="text-xs font-bold" style={{color:C.purple}}>🎙️ COMMENTARY</span>
                  {agentSystemRef.current&&(
                    <div className="flex gap-1.5 ml-auto">
                      {COMMENTATOR_PROFILES.map(p=><span key={p.id} className="text-sm" title={`${p.name} • ${p.role}`}>{p.emoji}</span>)}
                      <span className="text-sm" title="Referee">⚖️</span>
                    </div>
                  )}
                  {!agentSystemRef.current&&apiKey&&(
                    <span className="ml-auto text-xs" style={{opacity:0.5}}>key set — next kick off</span>
                  )}
                  {!agentSystemRef.current&&!apiKey&&(
                    <button onClick={()=>setShowApiKeyModal(true)} className="ml-auto text-xs border px-2 py-0.5" style={bdr(C.purple,C.abyss)}>⚙️ ENABLE AI</button>
                  )}
                </div>
                <div ref={evtLogRef} className="p-2 overflow-y-auto" style={{height:'360px',scrollbarWidth:'thin',scrollbarColor:`${C.purple} ${C.abyss}`}}>
                  {commentaryFeed.length===0&&(
                    <div className="text-xs text-center py-20" style={{opacity:0.4}}>
                      {ms.minute===0?'Press PLAY to begin':'Agents are watching...'}
                    </div>
                  )}
                  {[...commentaryFeed].reverse().map((item,i)=>{
                    if(item.type==='commentator'){
                      return(
                        <div key={i} className="mb-3 border-l-2 pl-2" style={{borderColor:item.color}}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-sm">{item.emoji}</span>
                            <span className="text-xs font-bold" style={{color:item.color}}>{item.name}</span>
                            <span className="text-xs" style={{color:item.color,opacity:0.55}}>{item.role}</span>
                            <span className="text-xs ml-auto" style={{opacity:0.35}}>{item.minute}'</span>
                          </div>
                          <div className="text-xs italic leading-relaxed" style={{opacity:0.9}}>"{item.text}"</div>
                        </div>
                      );
                    }
                    if(item.type==='referee'){
                      return(
                        <div key={i} className="mb-3 border-l-2 pl-2" style={{borderColor:'#FFD700'}}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-sm">⚖️</span>
                            <span className="text-xs font-bold" style={{color:'#FFD700'}}>{item.name}</span>
                            <span className="text-xs ml-auto" style={{opacity:0.35}}>{item.minute}'</span>
                          </div>
                          <div className="text-xs italic leading-relaxed" style={{opacity:0.9}}>"{item.text}"</div>
                        </div>
                      );
                    }
                    const bc=item.isGoal?C.purple:item.cardType==='red'?C.red:item.cardType==='yellow'?'#FFD700':C.dust;
                    return(
                      <div key={i} className="mb-2 border-l-2 pl-2" style={{borderColor:bc,backgroundColor:item.isGoal?`${C.purple}10`:item.cardType==='red'?`${C.red}08`:undefined}}>
                        <div className="flex gap-2 text-xs">
                          <span className="font-bold shrink-0" style={{color:C.purple}}>{item.minute}'</span>
                          <span className="leading-relaxed" style={{opacity:0.9}}>{item.text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── RIGHT: Away Team ─────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="border p-2" style={bdr(ms.awayTeam.color,C.ash)}>
                <div className="text-sm font-bold truncate" style={{color:ms.awayTeam.color}}>{ms.awayTeam.name}</div>
                <div className="text-xs mt-0.5" style={{opacity:0.6}}>{aiManager.awayFormation} • {aiManager.awayTactics.replace(/_/g,' ').toUpperCase()}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span>{EMO_ICON[aiManager.awayManager.emotion]||'😐'}</span>
                  <span className="text-xs font-bold" style={{color:ms.awayTeam.color}}>{aiManager.awayManager.name}</span>
                  <span className="text-xs ml-auto" style={{opacity:0.5}}>{ms.substitutionsUsed.away}/3 subs</span>
                </div>
              </div>
              <div className="border" style={bdr(ms.awayTeam.color)}>
                <div className="px-2 py-1.5 border-b text-xs font-bold" style={{borderColor:ms.awayTeam.color,color:ms.awayTeam.color}}>🧑‍💼 MANAGER</div>
                <div className="p-2 overflow-y-auto" style={{height:'160px',scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} ${C.abyss}`}}>
                  {awayManagerFeed.length===0
                    ?<div className="text-xs text-center py-8" style={{opacity:0.4}}>Watching from the touchline...</div>
                    :[...awayManagerFeed].reverse().map((item,i)=>(
                      <div key={i} className="mb-2 pb-1.5 border-b last:border-0" style={{borderColor:`${ms.awayTeam.color}30`}}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs font-bold" style={{color:ms.awayTeam.color}}>{item.emoji} {item.name}</span>
                          <span className="text-xs ml-auto" style={{opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div className="text-xs italic leading-relaxed" style={{opacity:0.9}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="border" style={bdr(`${ms.awayTeam.color}80`,C.abyss)}>
                <div className="px-2 py-1.5 border-b text-xs font-bold" style={{borderColor:`${ms.awayTeam.color}80`,color:ms.awayTeam.color}}>💭 PLAYER THOUGHTS</div>
                <div className="p-2 overflow-y-auto" style={{height:'220px',scrollbarWidth:'thin',scrollbarColor:`${ms.awayTeam.color} ${C.abyss}`}}>
                  {awayThoughtsFeed.length===0
                    ?<div className="text-xs text-center py-10" style={{opacity:0.4}}>Quiet minds...</div>
                    :[...awayThoughtsFeed].reverse().map((item,i)=>(
                      <div key={i} className="mb-2 pb-1.5 border-b last:border-0" style={{borderColor:`${ms.awayTeam.color}25`}}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span>{item.emoji}</span>
                          <span className="text-xs font-bold truncate" style={{color:item.color||ms.awayTeam.color}}>{item.name}</span>
                          <span className="text-xs ml-auto shrink-0" style={{opacity:0.4}}>{item.minute}'</span>
                        </div>
                        <div className="text-xs italic leading-relaxed" style={{opacity:0.85}}>"{item.text}"</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Pre-match AI prompt ─────────────────────────────────────────────── */}
        {!aiManager&&!apiKey&&(
          <div className="border p-3 mb-3 text-center" style={bdr(C.dust)}>
            <div className="text-xs mb-2" style={{opacity:0.6}}>Commentators, managers &amp; players can be powered by Claude AI</div>
            <button onClick={()=>setShowApiKeyModal(true)} className="px-4 py-1.5 border text-xs font-bold" style={bdr(C.purple,C.abyss)}>⚙️ SET API KEY TO ENABLE AGENTS</button>
          </div>
        )}
        {!aiManager&&apiKey&&(
          <div className="border p-2 mb-3 text-center text-xs" style={bdr(C.dust)}>
            <span style={{opacity:0.5}}>🔑 API key set — LLM agents activate on KICK OFF</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-3">
          {[['home',ms.homeTeam,aiManager?.homeAgents,ms.homeTeam.color],['away',ms.awayTeam,aiManager?.awayAgents,ms.awayTeam.color]].map(([k,team,agents,color])=>{
            return(
              <div key={k} className="border p-2" style={bdr(C.dust)}>
                <div className="text-xs font-bold mb-1 text-center" style={{color}}>{team.name} • {ms.substitutionsUsed[k]}/3 Subs</div>
                <div className="text-xs mb-2 text-center" style={{opacity:0.4}}>tap a player for stats</div>
                <div className="text-xs font-bold mb-1" style={{opacity:0.7}}>ON PITCH</div>
                {ms.activePlayers[k].map((name,i)=>{
                  const p=team.players.find(x=>x.name===name);
                  return p?<PlayerRow key={i} player={p} stats={ms.playerStats} isActive={true} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName}/>:null;
                })}
                <div className="text-xs font-bold mt-2 mb-1" style={{opacity:0.7}}>BENCH</div>
                {team.players.filter(p=>!ms.activePlayers[k].includes(p.name)).sort((a,b)=>POS_ORDER[a.position]-POS_ORDER[b.position]).map((p,i)=>(
                  <PlayerRow key={i} player={p} stats={ms.playerStats} isActive={false} teamColor={color} agents={agents} isHome={k==='home'} teamName={team.shortName}/>
                ))}
              </div>
            );
          })}
        </div>

      </div>
      {htReport&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{backgroundColor:'rgba(0,0,0,0.92)'}}>
          <div className="w-full max-w-lg border overflow-hidden" style={bdr(C.purple,C.ash)}>
            <div className="p-3 text-center border-b" style={{borderColor:C.purple}}>
              <div className="text-xs mb-1" style={{color:C.purple,opacity:0.7}}>⏸ HALF TIME</div>
              <div className="flex items-center justify-center gap-6">
                <div className="text-lg font-bold" style={{color:htReport.homeTeam.color}}>{htReport.homeTeam.shortName}</div>
                <div className="text-5xl font-bold">{htReport.score[0]} – {htReport.score[1]}</div>
                <div className="text-lg font-bold" style={{color:htReport.awayTeam.color}}>{htReport.awayTeam.shortName}</div>
              </div>
            </div>
            <div className="p-3 overflow-y-auto" style={{maxHeight:'80vh'}}>
              <div className="grid grid-cols-3 gap-2 mb-3 text-center text-xs">
                {[['GOALS',htReport.goals.length],['SHOTS',htReport.shots],['CARDS',htReport.cards.length]].map(([l,v])=>(
                  <div key={l} className="p-2 border" style={bdr(C.dust,C.abyss)}><div style={{opacity:0.6}}>{l}</div><div className="font-bold text-lg">{v}</div></div>
                ))}
              </div>
              {htReport.goals.length>0&&<div className="mb-3">{htReport.goals.map((g,i)=>(
                <div key={i} className="flex gap-2 text-xs py-1 border-b" style={{borderColor:C.dust}}>
                  <span style={{color:C.purple}}>{g.minute}'</span><span className="font-bold">{g.player}</span><span style={{opacity:0.5}}>{g.team}</span>
                </div>))}</div>}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[[C.red,htReport.homeManager,htLlmQuotes?.home||htReport.homeQuote,!htLlmQuotes?.home&&agentSystemRef.current],[C.purple,htReport.awayManager,htLlmQuotes?.away||htReport.awayQuote,!htLlmQuotes?.away&&agentSystemRef.current]].map(([col,name,quote,isLoading])=>(
                  <div key={name} className="p-2 border" style={bdr(col,C.abyss)}>
                    <div className="text-xs font-bold mb-1 flex items-center gap-1" style={{color:col}}>🎙️ {name}{agentSystemRef.current&&<span style={{opacity:0.5,fontSize:9}}>AI</span>}</div>
                    {isLoading?<div className="text-xs" style={{opacity:0.4}}>Generating...</div>:<div className="text-xs italic" style={{opacity:0.8}}>"{quote}"</div>}
                  </div>
                ))}
              </div>
              <div className="text-xs font-bold mb-2" style={{color:'#FFA500'}}>⚡ IN-PLAY BETS</div>
              <div className="mb-2 flex gap-2 items-center text-xs">
                <span style={{opacity:0.7}}>Stake:</span>
                <input type="number" value={betAmount} onChange={e=>setBetAmount(Math.max(0,Math.min(credits,parseInt(e.target.value)||0)))}
                  className="w-20 p-1 text-center border font-bold" style={{backgroundColor:C.abyss,borderColor:C.dust,color:C.dust}}/>
                <span style={{color:C.purple}}>{credits} coins</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <BetBtn type="homeWin" odds={odds.homeWin} label={matchState.homeTeam.shortName+' WIN'} color={C.red}/>
                <BetBtn type="draw" odds={odds.draw} label="DRAW"/>
                <BetBtn type="awayWin" odds={odds.awayWin} label={matchState.awayTeam.shortName+' WIN'}/>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <BetBtn type="btts" odds="1.75" label="BTTS YES"/>
                <BetBtn type="over25" odds="1.85" label="OVER 2.5"/>
              </div>
              {currentBets.length>0&&<div className="text-xs mb-2 text-center" style={{color:C.purple}}>{currentBets.length} wager{currentBets.length>1?'s':''} placed ✅</div>}
              <button onClick={startSecondHalf} className="w-full py-3 font-bold border" style={{backgroundColor:C.purple,color:C.abyss,borderColor:C.purple}}>▶ KICK OFF — SECOND HALF</button>
            </div>
          </div>
        </div>
      )}

      <PlayerCard sp={selectedPlayer}/>
      {showApiKeyModal&&<ApiKeyModal/>}

      <style>{`
        @keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
      `}</style>
    </div>
  );
};

export default MatchSimulator;
