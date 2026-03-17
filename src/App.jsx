import { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw, Settings } from "lucide-react";
import TEAMS from "./teams.js";
import { AgentSystem, COMMENTATOR_PROFILES } from "./agents.js";

const C = {
  abyss:'#111111', ash:'#1F1F1F', dust:'#E3E0D5',
  purple:'#9A5CF4', red:'#FF6B6B'
};
const bdr = (bc,bg='#1F1F1F') => ({border:`1px solid ${bc}`,backgroundColor:bg});
const PERS = {BAL:'balanced',SEL:'selfish',TEAM:'team_player',AGG:'aggressive',CAU:'cautious',CRE:'creative',LAZ:'lazy',WRK:'workhorse'};
const WX = {CLEAR:'clear',RAIN:'rain',HEAT:'heat',WIND:'wind',SNOW:'snow',METEOR:'meteor_shower',DUST:'dust_storm',SOLAR:'solar_flare',ACID:'acid_rain',ZERO:'zero_gravity',MAG:'magnetic_storm',CRYSTAL:'crystalline_fog',METH:'methane_rain',PLASMA:'plasma_winds',RING:'ring_shadow'};
const WX_ICON = {[WX.CLEAR]:'☀️',[WX.RAIN]:'🌧️',[WX.HEAT]:'🔥',[WX.WIND]:'💨',[WX.SNOW]:'❄️',[WX.METEOR]:'☄️',[WX.DUST]:'🌪️',[WX.SOLAR]:'⚡',[WX.ACID]:'☠️',[WX.ZERO]:'🌌',[WX.MAG]:'🧲',[WX.CRYSTAL]:'💎',[WX.METH]:'🧊',[WX.PLASMA]:'⚡',[WX.RING]:'🪐'};
const PLANET_WX = {'Mars':[WX.CLEAR,WX.DUST,WX.DUST,WX.METEOR,WX.WIND,WX.HEAT],'Phobos (Mars)':[WX.CLEAR,WX.METEOR,WX.ZERO,WX.DUST],'Saturn Rings':[WX.RING,WX.RING,WX.ZERO,WX.CRYSTAL,WX.CLEAR],'Titan (Saturn)':[WX.METH,WX.METH,WX.CRYSTAL,WX.WIND,WX.SNOW],'Enceladus (Saturn)':[WX.CRYSTAL,WX.CRYSTAL,WX.SNOW,WX.WIND,WX.CLEAR],'Europa (Jupiter)':[WX.CRYSTAL,WX.SNOW,WX.MAG,WX.CLEAR,WX.WIND],'Io (Jupiter)':[WX.ACID,WX.SOLAR,WX.HEAT,WX.ACID,WX.CLEAR],'Ganymede (Jupiter)':[WX.MAG,WX.MAG,WX.SNOW,WX.CLEAR,WX.WIND],'Triton (Neptune)':[WX.PLASMA,WX.METH,WX.SNOW,WX.CRYSTAL,WX.WIND]};
const MGER_EMO = {CALM:'calm',FRUS:'frustrated',EXC:'excited',ANG:'angry',NERV:'nervous',CONF:'confident',DESP:'desperate',JUB:'jubilant'};
const EMO_ICON = {[MGER_EMO.CALM]:'😌',[MGER_EMO.FRUS]:'😤',[MGER_EMO.EXC]:'😃',[MGER_EMO.ANG]:'😡',[MGER_EMO.NERV]:'😰',[MGER_EMO.CONF]:'😎',[MGER_EMO.DESP]:'😱',[MGER_EMO.JUB]:'🤩'};
const PERS_ICON = {[PERS.SEL]:'🎯',[PERS.TEAM]:'🤝',[PERS.AGG]:'⚔️',[PERS.CAU]:'🛡️',[PERS.CRE]:'✨',[PERS.LAZ]:'😴',[PERS.WRK]:'💪',[PERS.BAL]:'⚖️'};
const REFS = ['Commander Voss','Justice Krell','Arbiter Sol','Ref-9000','Magistrate Zuri','Judge Orion'];
const STADIUMS = [
  {name:'Olympus Mons Arena',planet:'Mars',capacity:'89,000'},
  {name:'Titan Dome',planet:'Titan (Saturn)',capacity:'76,000'},
  {name:'Cassini Division Field',planet:'Saturn Rings',capacity:'65,000'},
  {name:'Valles Marineris Stadium',planet:'Mars',capacity:'92,000'},
  {name:'Europa Ice Bowl',planet:'Europa (Jupiter)',capacity:'58,000'},
  {name:'Enceladus Geysers Ground',planet:'Enceladus (Saturn)',capacity:'45,000'},
  {name:'Phobos Crater Coliseum',planet:'Phobos (Mars)',capacity:'38,000'},
  {name:'Io Volcanic Park',planet:'Io (Jupiter)',capacity:'71,000'},
  {name:'Ganymede Glacier Stadium',planet:'Ganymede (Jupiter)',capacity:'82,000'},
  {name:'Triton Nitrogen Fields',planet:'Triton (Neptune)',capacity:'51,000'}
];

function createAgent(player, isHome) {
  const pos = player.position;
  let personality = PERS.BAL;
  const {attacking:atk=70,defending:def=70,mental:men=70,athletic:ath=70} = player;
  if(atk>82&&pos==='FW') personality=PERS.SEL;
  else if(men>78) personality=PERS.TEAM;
  else if(def>82&&pos==='DF') personality=PERS.AGG;
  else if(ath<70) personality=PERS.LAZ;
  else if(ath>85) personality=PERS.WRK;
  else if(Math.random()<0.1) personality=PERS.CRE;
  else if(Math.random()<0.2) personality=PERS.CAU;

  return {
    player, isHome, personality,
    confidence:50, fatigue:0, form:0, morale:75,
    emotion:'neutral', emotionIntensity:0, emotionDuration:0,
    injuryRisk:0, isCaptain:false, isClutch:Math.random()<0.15,
    penaltyAbility:(men+atk)/2+Math.random()*20,
    getDecisionBonus() {
      let bonus=0;
      if(this.personality===PERS.SEL) bonus+=10;
      if(this.personality===PERS.CRE) bonus+=8;
      if(this.confidence>70) bonus+=5;
      if(this.fatigue>70) bonus-=10;
      if(this.emotion==='ecstatic') bonus+=8;
      if(this.emotion==='anxious') bonus-=5;
      return bonus;
    },
    updateFatigue(mins) { this.fatigue=Math.min(100,this.fatigue+mins*(0.8+Math.random()*0.4)); if(this.fatigue<30)this.injuryRisk=5; else if(this.fatigue<60)this.injuryRisk=10; else this.injuryRisk=20; },
    updateConfidence(delta) { this.confidence=Math.max(0,Math.min(100,this.confidence+delta)); },
    triggerEmotion(type) {
      const map={goal_scored:['ecstatic',90,8],goal_assisted:['proud',70,5],shot_missed:['frustrated',50,4],yellow_card:['anxious',60,6],red_card:['devastated',95,10]};
      const e=map[type]; if(e){this.emotion=e[0];this.emotionIntensity=e[1];this.emotionDuration=e[2];}
    },
    updateEmotion(mins) { if(this.emotionDuration>0){this.emotionDuration-=mins; if(this.emotionDuration<=0){this.emotion='neutral';this.emotionIntensity=0;}} },
    getThought(min,state) {
      const thoughts={
        [PERS.SEL]:['I need that goal for my stats!','Just give me the ball!','I should shoot more.'],
        [PERS.TEAM]:['We need to work together.','Pass it! Teammate is open!','Let\'s do this as a unit.'],
        [PERS.AGG]:['I\'ll tackle anything that moves!','Push them harder!','No mercy!'],
        [PERS.CAU]:['Stay compact. Don\'t overcommit.','Hold the line.','Patience wins games.'],
        [PERS.CRE]:['What if I tried a rabona here?','Creativity wins matches!','Let me try something special...'],
        [PERS.LAZ]:['So tired...','Maybe someone else will cover?','Just 5 more minutes...'],
        [PERS.WRK]:['Keep going! Never stop!','Give everything!','One more sprint!'],
        [PERS.BAL]:['Stay focused.','Read the game.','Solid performance needed.']
      };
      const t=thoughts[this.personality]||thoughts[PERS.BAL];
      if(Math.random()<0.3) return pick(t);
      if(state.scoreDiff<0&&min>70) return 'We NEED to score! Push forward!';
      if(state.scoreDiff>0&&min>80) return 'Hold on! Defend this lead!';
      return null;
    },
    canTakePenalty() { return this.penaltyAbility>100; }
  };
}

function createAIManager(homeTeam, awayTeam) {
  const homeAgents = homeTeam.players.map(p=>createAgent(p,true));
  const awayAgents = awayTeam.players.map(p=>createAgent(p,false));
  const allH=homeAgents, allA=awayAgents;
  const activeH=homeAgents.filter(a=>a.player.starter);
  const activeA=awayAgents.filter(a=>a.player.starter);
  const captH=activeH.reduce((b,a)=>a.player.mental>b.player.mental?a:b,activeH[0]);
  const captA=activeA.reduce((b,a)=>a.player.mental>b.player.mental?a:b,activeA[0]);
  if(captH)captH.isCaptain=true;
  if(captA)captA.isCaptain=true;
  const stadium=homeTeam.stadium||pick(STADIUMS);
  const wxOpts=PLANET_WX[stadium.planet]||Object.values(WX);
  const weather=pick(wxOpts);
  const tactics=['high_press','possession','counter_attack','park_the_bus','gegenpress','tiki_taka'];
  const homeTactics=homeTeam.tactics?.toLowerCase().replace(' ','_')||pick(tactics);
  const awayTactics=awayTeam.tactics?.toLowerCase().replace(' ','_')||pick(tactics);
  const ref={name:pick(REFS),leniency:30+Math.random()*70,strictness:Math.random()*100};
  const homeM={name:homeTeam.manager?.name||'Manager Alpha',emotion:MGER_EMO.CALM,personality:homeTeam.manager?.personality||'Aggressive',team:homeTeam};
  const awayM={name:awayTeam.manager?.name||'Manager Beta',emotion:MGER_EMO.CALM,personality:awayTeam.manager?.personality||'Calculated',team:awayTeam};
  const temp=Math.round(-50+Math.random()*120);
  const times=['Morning','Afternoon','Evening','Night','Dawn','Dusk'];
  const timeOfDay=pick(times);

  return {
    homeAgents:allH, awayAgents:allA,
    activeHomeAgents:activeH, activeAwayAgents:activeA,
    stadium, weather, temperature:temp, timeOfDay,
    homeTactics, awayTactics,
    homeFormation:homeTeam.formation||'4-4-2',
    awayFormation:awayTeam.formation||'4-3-3',
    referee:ref, homeManager:homeM, awayManager:awayM,
    getAgentByName(name) { return [...allH,...allA].find(a=>a.player.name===name)||null; },
    updateAllAgents(mins) {
      [...activeH,...activeA].forEach(a=>{a.updateFatigue(mins);a.updateEmotion(mins);});
    },
    handleSubstitution(out,inName,isHome) {
      const team=isHome?allH:allA; const active=isHome?activeH:activeA;
      const inAgent=team.find(a=>a.player.name===inName);
      const idx=active.findIndex(a=>a.player.name===out);
      if(idx>=0&&inAgent) active.splice(idx,1,inAgent);
    },
    shouldGiveCard(severity) {
      if(severity>90-ref.strictness*0.3) return 'red';
      if(severity>60-ref.strictness*0.2) return 'yellow';
      return null;
    },
    updateManagerEmotion(event,hScore,aScore) {
      const diff=hScore-aScore;
      if(event.isGoal) {
        if(event.team===homeTeam.shortName) homeM.emotion=MGER_EMO.JUB;
        else awayM.emotion=MGER_EMO.JUB;
      }
      if(diff<-1) homeM.emotion=MGER_EMO.DESP;
      if(diff>1) homeM.emotion=MGER_EMO.CONF;
    },
    getDecisionInfluence(gameState) {
      const influence={home:{SHOOT:0,ATTACK:0,DEFEND:0,TACKLE:0,FOUL:0},away:{SHOOT:0,ATTACK:0,DEFEND:0,TACKLE:0,FOUL:0}};
      [...activeH].forEach(a=>{const d=a.getDecisionBonus();influence.home.SHOOT+=d>5?1:0;influence.home.ATTACK+=d>0?1:0;});
      [...activeA].forEach(a=>{const d=a.getDecisionBonus();influence.away.SHOOT+=d>5?1:0;influence.away.ATTACK+=d>0?1:0;});
      return influence;
    },
    giveTeamTalk(isHome,scoreDiff) {
      if(Math.abs(scoreDiff)<1) return null;
      const mgr=isHome?homeM:awayM;
      const talk=scoreDiff<0?`${mgr.name} fires up the team! GET OUT THERE AND FIGHT!`:`${mgr.name} calls for discipline. Hold what we have.`;
      return {commentary:talk};
    },
    managerTacticalShout(isHome,minute,scoreDiff) {
      if(Math.random()>0.1) return null;
      const mgr=isHome?homeM:awayM;
      const shouts=[`${mgr.name} urges more intensity!`,`${mgr.name} screaming instructions!`,`${mgr.name} demands a goal!`];
      return {commentary:pick(shouts)};
    }
  };
}

const POS_ORDER={'GK':0,'DF':1,'MF':2,'FW':3};
const rnd=(min,max)=>Math.random()*(max-min)+min;
const rndI=(min,max)=>Math.floor(rnd(min,max+1));
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];

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

  const getActive=(team,active)=>team.players.filter(p=>active.includes(p.name));
  const teamStats=(team,active)=>{
    const pl=getActive(team,active).filter(p=>p.position!=='GK');
    if(!pl.length)return{attacking:0,defending:0,technical:0,athletic:0,mental:0};
    const avg=k=>pl.reduce((s,p)=>s+(p[k]||70),0)/pl.length;
    return{attacking:avg('attacking'),defending:avg('defending'),technical:avg('technical'),athletic:avg('athletic'),mental:avg('mental')};
  };
  const getPlayer=(team,active,stat,pos)=>{
    let pool=team.players.filter(p=>active.includes(p.name));
    if(!pool.length)return null;
    if(pos){const pp=pool.filter(p=>p.position===pos);if(pp.length)pool=pp;}
    if(!stat)return pick(pool);
    const w=pool.map(p=>p[stat]||50),tot=w.reduce((a,b)=>a+b,0);
    if(!tot)return pool[0];
    let r=rnd(0,tot);
    for(let i=0;i<pool.length;i++){r-=w[i];if(r<=0)return pool[i];}
    return pool[0];
  };
  const formBonus=(name,stats)=>{
    const s=stats[name]||{};
    return (s.goals||0)*10+(s.goals>=2?10:s.goals===1?5:0)+(s.assists>=2?5:0)+(s.saves>=3?8:0)+(s.tackles>=3?5:0)-(s.yellowCard?5:0)-(s.injured?20:0);
  };
  const makeSub=(team,out,active,subsUsed,stats)=>{
    const subs=team.players.filter(p=>!p.starter&&!active.includes(p.name)&&!stats[p.name]?.injured&&!stats[p.name]?.redCard);
    if(!subs.length||subsUsed>=3)return{substitute:null,newActive:active.filter(n=>n!==out)};
    const outP=team.players.find(p=>p.name===out);
    const sub=subs.find(p=>p.position===outP?.position)||subs[0];
    return{substitute:sub.name,newActive:active.map(n=>n===out?sub.name:n)};
  };
  const calcMVP=(stats,home,away)=>{
    let best=null,maxScore=0;
    [...home.players,...away.players].filter(p=>stats[p.name]).forEach(p=>{
      const s=stats[p.name]||{};
      const score=(s.goals||0)*10+(s.assists||0)*6+(s.saves||0)*4+(s.tackles||0)*2-(s.yellowCard?3:0)-(s.redCard?10:0);
      if(score>maxScore){maxScore=score;best={...p,team:(home.players.includes(p)?home:away).name,teamColor:(home.players.includes(p)?home:away).color,stats:s};}
    });
    return best;
  };

  // ─── Unified outcome resolver ───────────────────────────────────────────────
  // type: 'shot' | 'penalty' | 'freekick' | 'header' | 'tackle'
  // Returns { outcome, margin, flavour[] }
  const resolveContest=(atkPlayer,atkAgent,defPlayer,defAgent,ctx={})=>{
    const{type='shot',weather=WX.CLEAR,isClutch=false}=ctx;
    // Base stat by contest type
    const atkStat=type==='freekick'?(atkPlayer.technical||70)*0.6+(atkPlayer.mental||70)*0.4
      :type==='penalty'?(atkPlayer.technical||70)*0.5+(atkPlayer.mental||70)*0.5
      :type==='header'?(atkPlayer.athletic||70)*0.7+(atkPlayer.mental||70)*0.3
      :type==='tackle'?(atkPlayer.defending||70)*0.8+(atkPlayer.athletic||70)*0.2
      :(atkPlayer.attacking||70)*0.6+(atkPlayer.athletic||70)*0.4;
    const defStat=type==='tackle'?(defPlayer?.attacking||70)*0.6+(defPlayer?.athletic||70)*0.4
      :(defPlayer?.defending||70)*0.7+(defPlayer?.mental||70)*0.3;
    // Agent modifiers + flavour tags
    const flavour=[];let atkMod=0,defMod=0;
    if(atkAgent){
      if(atkAgent.confidence>75){atkMod+=8;flavour.push('confident');}
      else if(atkAgent.confidence<30){atkMod-=5;flavour.push('low_confidence');}
      if(atkAgent.fatigue>80){atkMod-=12;flavour.push('exhausted');}
      else if(atkAgent.fatigue>65){atkMod-=5;flavour.push('tired');}
      if(atkAgent.emotion==='ecstatic'){atkMod+=10;flavour.push('ecstatic');}
      else if(atkAgent.emotion==='anxious'||atkAgent.emotion==='nervous'){atkMod-=8;flavour.push('anxious');}
      else if(atkAgent.emotion==='devastated'){atkMod-=8;flavour.push('devastated');}
      if(isClutch&&atkAgent.isClutch){atkMod+=14;flavour.push('clutch');}
      if(atkAgent.personality===PERS.CRE){atkMod+=3;flavour.push('creative');}
      if(atkAgent.personality===PERS.AGG){atkMod+=2;}
    }
    if(defAgent){
      if(defAgent.confidence<30)defMod-=8;
      if(defAgent.fatigue>80)defMod-=10;
      if(defAgent.emotion==='devastated'||defAgent.emotion==='anxious')defMod-=5;
    }
    // Weather
    if(weather===WX.RAIN||weather===WX.STORM){atkMod-=5;defMod-=3;}
    if(weather===WX.WIND)atkMod-=8;
    // Rolls
    const atkRoll=atkStat+atkMod+rnd(-20,20);
    const defRoll=defStat+defMod+rnd(-15,15);
    const net=atkRoll-defRoll;
    // Resolve by type
    let outcome;
    if(type==='penalty'){
      const prob=Math.min(0.85,0.50+net/250);
      const scored=Math.random()<prob;
      const saved=!scored&&Math.random()<0.65;
      outcome=scored?'goal':saved?'saved':'miss';
    } else if(type==='tackle'){
      outcome=net>10?'won':net>-10?'contested':'lost';
    } else {
      const threshold=type==='freekick'?28:25;
      const isPost=net<=threshold&&net>12&&Math.random()<0.15;
      outcome=net>threshold?'goal':isPost?'post':net>8?'saved':'miss';
    }
    return{outcome,margin:net,flavour};
  };

  // ─── Stat-reactive commentary builder ───────────────────────────────────────
  // flavour tags from resolveContest drive line selection
  const buildCommentary=(type,actors,outcome,flavour=[],ctx={})=>{
    const atk=actors.attacker||'The player';
    const def=actors.defender||'the keeper';
    const exhausted=flavour.includes('exhausted');
    const clutch=flavour.includes('clutch');
    const anxious=flavour.includes('anxious');
    const ecstatic=flavour.includes('ecstatic');
    const confident=flavour.includes('confident');
    const creative=flavour.includes('creative');
    const low_conf=flavour.includes('low_confidence');
    const {min=45,scoreDiff=0,playerGoals=0}=ctx;
    const phase=min<=25?'early':min<=65?'midgame':min<=82?'late':'dying';
    const desperate=scoreDiff<-1&&min>65;
    const protecting=scoreDiff>1;
    const onFire=playerGoals>0;
    const hatTrick=playerGoals>=2;
    const T={
      shot:{
        goal:[
          hatTrick&&`⚽ HAT TRICK HUNT — AND ${atk} DELIVERS! The third! THE THIRD!`,
          onFire&&`⚽ ${atk} cannot stop scoring today! Another one! What a performance!`,
          onFire&&`⚽ His second of the game — ${atk} is absolutely on fire right now!`,
          desperate&&`⚽ ${atk} DRAGS THEM BACK! The goal they were SCREAMING for!`,
          protecting&&`⚽ Game effectively over! ${atk} makes it a commanding lead!`,
          phase==='dying'&&`⚽ AT THE DEATH! ${atk} BREAKS HEARTS! The stadium EXPLODES!`,
          phase==='early'&&`⚽ EARLY GOAL! ${atk} has given them the PERFECT start!`,
          phase==='late'&&`⚽ AT THE CRUCIAL MOMENT — ${atk} delivers the lead!`,
          clutch&&`⚽ CLUTCH MOMENT — ${atk} DELIVERS! That is what big players do!`,
          exhausted&&`⚽ On fumes — but ${atk} still finds the net! Extraordinary!`,
          ecstatic&&`⚽ ${atk} is UNSTOPPABLE right now! Everything is going in!`,
          confident&&`⚽ ${atk} — oozing confidence! Knew exactly where that was going!`,
          `⚽ GOAL! ${atk} fires past ${def}! Stunning finish!`,
          `⚽ ${atk} — clinical! ${def} had no chance!`,
          `⚽ ${atk} slots it home. Composed when it mattered.`,
          `⚽ The net bulges! ${atk} puts it away with authority!`,
          `⚽ BEAUTIFUL FINISH from ${atk}! ${def} is left rooted to the spot!`,
          `⚽ In off the post — and ${atk} doesn't care HOW it goes in! GOAL!`,
          `⚽ Oh, that is a wonderful strike. ${atk} — remember that name.`,
          `⚽ ${atk} takes one touch, steps inside, and buries it. Effortless.`,
          `⚽ Low and hard — ${def} gets a hand to it but can't stop it! ${atk} scores!`,
        ].filter(Boolean),
        saved:[
          phase==='dying'&&`Agonising! ${atk} fires — ${def} SAVES THE DAY in stoppage time!`,
          phase==='dying'&&`NO! ${def} throws himself at the effort — KEPT OUT! Agony for ${atk}!`,
          desperate&&`${atk} gets a shot off — but ${def} absolutely REFUSES to be beaten!`,
          onFire&&`${atk} tries to add to his tally — ${def} says NO this time!`,
          protecting&&`${def} comfortable — ${atk} didn't trouble him. Lead intact.`,
          anxious&&`${atk} hesitates a fraction — ${def} reads the delay perfectly. Saved.`,
          exhausted&&`${atk} just can't generate the power. ${def} grateful — comfortable stop.`,
          low_conf&&`${atk} telegraphs it entirely. ${def} had it covered all along.`,
          confident&&`${def} earns his fee — ${atk} looked certain to score there.`,
          `${def} SAVES! Gets down brilliantly to deny ${atk}!`,
          `Fingertips! ${def} barely gets there — magnificent stop!`,
          `${def} reads it perfectly — never in doubt.`,
          `Smothered! ${def} makes himself big — the shot is blocked!`,
          `${atk} pulls the trigger — ${def} is in exactly the right place!`,
          `Great technique from ${atk}, but ${def} is having none of it!`,
          `${def} with two hands to it — pushed wide! Corner.`,
          `${def} DIVES FULL STRETCH — denies ${atk} brilliantly!`,
          `${atk} shoots first time — but ${def} reacts instantly. Incredible reflexes.`,
        ].filter(Boolean),
        miss:[
          phase==='dying'&&`${atk} BLAZES OVER! Oh, that will haunt him! The clock is running out!`,
          phase==='early'&&`${atk} lifts his head too early — dragged wide. Early chance gone.`,
          desperate&&`${atk} rushes the effort in desperation — WIDE! The head drops.`,
          onFire&&`Can't believe it — ${atk} was looking for more after scoring earlier. Blazes over.`,
          anxious&&`${atk} rushes the shot — balloons it over. The pressure showing.`,
          exhausted&&`The legs are gone. ${atk}'s effort drifts harmlessly wide.`,
          `${atk} fires wide — so much promise, so little end product.`,
          `Over the bar! ${atk} will be furious with that decision.`,
          `${atk} pulls it wide. The chance is gone.`,
          `Ballooned! ${atk} got it wrong — miles over.`,
          `Wide of the post! ${atk} won't want to watch that back.`,
          `${atk} hesitates — the moment passes. The shot is barely a shot.`,
          `${atk} takes aim — and finds the advertising hoarding instead.`,
          `So close — and yet. ${atk} can only shake his head slowly.`,
          `The angle closed down. ${atk} couldn't find a way through.`,
        ].filter(Boolean),
        post:[
          phase==='dying'&&`🏗️ THE POST IN INJURY TIME! ${atk} — oh, the AGONY!`,
          `🏗️ THE WOODWORK! ${atk} was agonisingly close!`,
          `Off the post! ${atk} can't believe it!`,
          `THE BAR! ${atk} struck it perfectly — the goal just wouldn't come!`,
          `🏗️ Ring of steel! The post denies ${atk}!`,
          `🏗️ Off the frame! ${atk}'s effort rattles the woodwork and bounces clear!`,
          `Post! Then bar! Then scrambled clear! ${atk} is DEVASTATED!`,
          `That hit the post and came out. ${def} could barely watch.`,
          `🏗️ THE UPRIGHT! ${atk}'s shot was goal-bound all the way — until the post said no.`,
        ].filter(Boolean),
      },
      freekick:{
        goal:[
          phase==='dying'&&`⚽ FREE KICK GOAL IN STOPPAGE TIME! ${atk} picks the PERFECT moment!`,
          desperate&&`⚽ FREE KICK — and it's IN! ${atk} keeps the dream alive!`,
          creative&&`⚽ GENIUS! ${atk} bends it around the wall — pure artistry!`,
          confident&&`⚽ ${atk} steps up without hesitation — top corner. No debate.`,
          clutch&&`⚽ PRESSURE FREE KICK — and ${atk} nails it! Ice in the veins!`,
          `⚽ DIRECT FREE KICK GOAL! ${atk} — unstoppable!`,
          `⚽ ${atk} curls it over the wall and into the net! Spectacular!`,
          `⚽ ${atk} goes low under the wall — nestles in the corner! Brilliant!`,
          `⚽ FREE KICK — WHAT A STRIKE! ${atk} with perfect execution!`,
          `⚽ The wall jumped. The ball went under. ${atk} doesn't care — GOAL!`,
          `⚽ ${atk} whips it over the wall with incredible bend. ${def} rooted.`,
        ].filter(Boolean),
        saved:[
          phase==='dying'&&`What a save! ${def} tips over the free kick with seconds remaining!`,
          `${def} dives brilliantly — FREE KICK SAVED!`,
          `${def} tips it over! Great free kick, better save!`,
          exhausted&&`${atk} doesn't get enough on it — ${def} comfortable.`,
          `${def} gets his angles right — free kick kept out.`,
          `Free kick — pushed wide by ${def}! Corner to ${atk}'s side.`,
          `${def} guesses correctly — full stretch to turn it away!`,
        ].filter(Boolean),
        miss:[
          anxious&&`${atk} rushes it — straight into the wall.`,
          `${atk}'s free kick drifts harmlessly wide.`,
          `Over the wall... and over the bar. Close, but not close enough.`,
          `${atk} catches the top of the wall — deflected away. No danger.`,
          `Free kick — fizzes past the post. Impressive attempt, no goal.`,
          `${atk} takes the free kick — the wall does its job. Blocked.`,
        ].filter(Boolean),
        post:[
          `🏗️ THE POST! ${atk} was AGONISINGLY close from the free kick!`,
          `🏗️ Inches away! The free kick from ${atk} crashes off the woodwork!`,
        ].filter(Boolean),
      },
      penalty:{
        goal:[
          hatTrick&&`⚽ PENALTY — and ${atk} completes the hat-trick! Absolutely LEGENDARY!`,
          desperate&&`⚽ PENALTY! ${atk} sends them level! The place is SHAKING!`,
          phase==='dying'&&`⚽ PENALTY SCORED IN INJURY TIME! ${atk}! The stadium is CARNAGE!`,
          clutch&&`⚽ PENALTY — and ${atk} is ice cold! RIGHT in the corner!`,
          confident&&`⚽ ${atk} doesn't even look at the keeper. Straight down the middle. Goal.`,
          ecstatic&&`⚽ ${atk} is on fire — and buries the penalty to prove it!`,
          anxious&&`⚽ ${atk} stutters in the run-up... but gets away with it! GOAL!`,
          `⚽ PENALTY SCORED! ${atk} sends ${def} the wrong way!`,
          `⚽ ${atk} steps up and CONVERTS! Emphatic!`,
          `⚽ ${atk} — no hesitation, no drama. Just a goal. Ruthless.`,
          `⚽ Penalty tucks into the corner. ${atk} delivers.`,
          `⚽ ${atk} picks his spot — and puts it away. Cool as you like.`,
        ].filter(Boolean),
        saved:[
          phase==='dying'&&`PENALTY SAVED IN INJURY TIME! ${def} is the HERO! The whole team goes wild!`,
          anxious&&`${atk}'s nerve goes at the last second — ${def} dives the right way! SAVED!`,
          low_conf&&`${atk} couldn't hide the doubt — ${def} reads it completely. Saved.`,
          exhausted&&`${atk} lacks conviction in the run-up — ${def} comfortable. Saved.`,
          `${def} SAVES THE PENALTY! Dives brilliantly!`,
          `${def} guesses right — penalty saved! Incredible!`,
          `${def} GOES THE RIGHT WAY — denies ${atk}! Brilliant!`,
          `${atk} chooses his corner — but ${def} has already chosen the same one. SAVED!`,
          `${def} doesn't move until the last instant — then FLIES across. Saved.`,
        ].filter(Boolean),
        miss:[
          anxious&&`${atk} panics — blazes it over the bar! Absolute horror.`,
          phase==='dying'&&`${atk} MISSES THE PENALTY IN INJURY TIME! Over the bar! The AGONY!`,
          `${atk} sends it over the crossbar! Incredible miss!`,
          `Wide of the post! ${atk} will be haunted by that.`,
          `${atk} hits the side-netting — no goal! The keeper didn't even move.`,
          `THE BAR saves the keeper! Penalty beats the man but not the woodwork!`,
        ].filter(Boolean),
      },
      header:{
        goal:[
          phase==='dying'&&`⚽ HEADER AT THE DEATH! ${atk} rises and WINS IT for them!`,
          desperate&&`⚽ ${atk} HEADS THEM BACK IN IT! The fight is NOT over!`,
          `⚽ HEADER! ${atk} rises highest — into the back of the net!`,
          clutch&&`⚽ ${atk} rises at the crucial moment — HEADED HOME!`,
          `⚽ Towering header from ${atk}! ${def} rooted to the spot!`,
          `⚽ Bullet header! ${atk} gets ABOVE everyone — unstoppable!`,
          `⚽ ${atk} attacks the ball and THUNDERS it home! Headers don't get better!`,
        ].filter(Boolean),
        saved:[
          `${def} claws it away! What a header from ${atk} — even better save!`,
          `${def} tips the header over the bar!`,
          `${atk} gets good contact — but ${def} was perfectly positioned.`,
          `Full-stretch from ${def} — the header turned behind!`,
        ].filter(Boolean),
        miss:[
          `${atk} gets above everyone but glances it wide.`,
          `Header from ${atk} — just over the crossbar!`,
          `${atk} meets it at the far post — angles it wide. Should've done better.`,
          `Too much power — ${atk}'s header clears the bar by a distance.`,
        ].filter(Boolean),
      },
      tackle:{
        won:[
          phase==='dying'&&`CRUCIAL TACKLE! ${atk} wins it cleanly — what composure under pressure!`,
          confident&&`${atk} reads it perfectly — the ball is theirs! Clean as you like.`,
          `${atk} times the tackle to perfection!`,
          `Crunching challenge from ${atk} — ball won!`,
          `${atk} arrives a fraction before ${def}. Quality defending.`,
          `Superb from ${atk}! The tackle is clean — the crowd recognises it.`,
          `${atk} slides in — and gets every bit of ball. Brilliant.`,
        ].filter(Boolean),
        contested:[
          `Fifty-fifty! Both players want it — neither gives an inch.`,
          `Contested ball — falls loose in midfield.`,
          `Both go in together — the referee watches carefully. Play on.`,
          `Battle for possession — nobody wins it cleanly.`,
        ].filter(Boolean),
        lost:[
          exhausted&&`${atk} lunges — but the legs aren't there. Beaten.`,
          `${atk} mistimes it — ${def} skips past!`,
          `${def} sees it coming a mile off — steps over and goes.`,
          `${atk} dives in — ${def} rides the challenge with ease.`,
        ].filter(Boolean),
      },
    };
    const pool=T[type]?.[outcome];
    if(!pool||pool.length===0)return`${atk} — ${outcome}.`;
    return pick(pool);
  };

  const genFreekickSeq=(min,taker,gk,posTeam,defTeam,aim,ctx={})=>{
    const seq=[];
    const takerAgent=aim?.getAgentByName(taker.name);
    const isCreative=takerAgent?.personality===PERS.CRE;
    const wallSize=rndI(3,7);
    seq.push({minute:min,type:'freekick_setup',team:posTeam.shortName,player:taker.name,
      commentary:pick([`📐 Free kick to ${posTeam.shortName}! Wall forming...`,`📐 ${taker.name} places the ball. Referee measures the distance.`,`📐 ${defTeam.shortName} organise their wall. ${taker.name} waits patiently.`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'freekick_wall',team:posTeam.shortName,
      commentary:pick([`🧱 ${wallSize}-man wall set by ${defTeam.shortName}. ${gk?.name||'The keeper'} bellows instructions.`,`${gk?.name||'The keeper'} organises the ${wallSize}-man wall — peering over them.`,`${wallSize} bodies in the wall. Everybody holds their breath.`]),momentumChange:[0,0]});
    if(isCreative&&Math.random()<0.45){
      seq.push({minute:min,type:'freekick_trick',team:posTeam.shortName,player:taker.name,
        commentary:pick([`${taker.name} motions to a teammate... something unconventional is brewing.`,`TWO PLAYERS over the ball! This could be unusual!`,`${taker.name} whispers something. The wall looks nervous.`]),momentumChange:[0,0]});
    }
    // Resolve via unified system
    const gkAgent=aim?.getAgentByName(gk?.name);
    const result=resolveContest(taker,takerAgent,gk||{},gkAgent,{type:'freekick',weather:aim?.weather});
    const isGoal=result.outcome==='goal';
    const outcomeCommentary=buildCommentary('freekick',{attacker:taker.name,defender:gk?.name||'the keeper'},result.outcome,result.flavour,ctx);
    return{sequence:seq,isGoal,outcomeCommentary};
  };

  const genCelebrationSeq=(min,scorer,team,mgrName,mgrEmotion,scorerAgent)=>{
    const seq=[];
    const emo=scorerAgent?.emotion;
    const isClutch=scorerAgent?.isClutch;
    const scorerComm=emo==='ecstatic'
      ?pick([`🎉 ${scorer} is in ANOTHER WORLD right now! Pure ecstasy!`,`🎉 ${scorer} SCREAMS to the sky — unstoppable! UNSTOPPABLE!`])
      :emo==='anxious'||emo==='nervous'
        ?pick([`🎉 ${scorer} — RELIEF more than joy. The weight LIFTED.`,`🎉 ${scorer} drops to his knees. Tension released.`])
        :isClutch
          ?pick([`🎉 ${scorer} points to the armband — THIS is what clutch means!`,`🎉 ${scorer} roars at the crowd. They asked for a hero. Here he is.`])
          :pick([`🎉 ${scorer} WHEELS AWAY! Arms wide, face to the sky!`,`🎉 ${scorer} SLIDES ON HIS KNEES! The crowd is ELECTRIC!`,`🎉 ${scorer} sprints to the corner flag — nothing but joy!`,`🎉 ${scorer} points to someone in the stands. This one is personal.`]);
    seq.push({minute:min,type:'celebration',team,player:scorer,commentary:scorerComm,momentumChange:[0,0]});
    seq.push({minute:min,type:'celebration_pile',team,
      commentary:pick([`Teammates FLOOD in from every direction!`,`The whole bench is off the seat — players sprinting on!`,`Bodies piling onto ${scorer}! Beautiful chaos!`,`Everyone wants a piece of ${scorer}! Pure elation!`]),momentumChange:[0,0]});
    if(mgrName){
      const mgrComm=mgrEmotion===MGER_EMO.JUB
        ?pick([`${mgrName} RACES down the touchline! Fists pumping!`,`${mgrName} turns to the crowd, arms raised — this is HIS moment too.`,`${mgrName} embraces the coaching staff! Eyes glistening!`])
        :pick([`${mgrName} applauds from the technical area.`,`${mgrName} nods calmly. As if they knew all along.`,`${mgrName} points back to the halfway line immediately. There's more to do.`]);
      seq.push({minute:min,type:'celebration_manager',team,commentary:mgrComm,momentumChange:[0,0]});
    }
    seq.push({minute:min,type:'celebration_restart',team,
      commentary:pick([`${team} restart. The opposition have a mountain to climb.`,`Ball placed on the centre spot. Game resumes.`,`Play restarts. But the energy in the stadium has completely shifted.`]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genVARSeq=(min,scorer,team,ref,overturned)=>{
    const seq=[];
    const refName=ref?.name||'The referee';
    seq.push({minute:min,type:'var_check',team,
      commentary:pick([`🖥️ WAIT — VAR is checking! Play suspended!`,`🖥️ VAR REVIEW IN PROGRESS! ${refName} has a finger to his earpiece.`,`🖥️ The goal is being checked! Was everything in order?`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'var_review',team,
      commentary:pick([`🔍 Multiple camera angles being studied...`,`⏳ The wait is agonising. Nobody in the stadium moves.`,`🔍 Checking for offside... position of feet... handball in build-up...`,`🔍 Frame by frame. Millimetres could decide this.`]),momentumChange:[0,0]});
    if(overturned){
      seq.push({minute:min,type:'var_decision',team,isVAROverturned:true,
        commentary:pick([`❌ GOAL DISALLOWED! VAR overturns! The goal does NOT stand!`,`❌ NO GOAL! Offside by a toenail! The celebrations are ERASED!`,`❌ DISALLOWED! Handball in the build-up! Heartbreak for ${scorer}!`,`❌ VAR SAYS NO! ${refName} waves it away — no goal!`]),momentumChange:[0,0]});
      seq.push({minute:min,type:'var_reaction',team,
        commentary:pick([`😱 ${scorer} is DEVASTATED. Sinks to their knees.`,`The ${team} bench erupts in fury! Arguments everywhere!`,`${refName} is surrounded by protesting players. Order barely restored.`,`Disbelief etched on every face. The stadium is stunned to silence.`]),momentumChange:[0,0]});
    } else {
      seq.push({minute:min,type:'var_decision',team,isVARConfirmed:true,
        commentary:pick([`✅ GOAL CONFIRMED! VAR backs the referee — it COUNTS!`,`✅ IT STANDS! No infringement found! ${scorer} CAN celebrate!`,`✅ GOOD GOAL! VAR finds nothing wrong! The stadium ERUPTS!`]),momentumChange:[0,0]});
    }
    return{sequence:seq};
  };

  const genSiegeSeq=(min,team,defTeam,clutchName)=>{
    const seq=[];
    seq.push({minute:min,type:'siege_start',team,
      commentary:pick([`⏱️ SIEGE MODE! ${team} throwing everyone forward!`,`⏱️ ALL OUT ATTACK from ${team}! They WILL NOT surrender!`,`⏱️ Bodies everywhere! ${team} in DESPERATE territory!`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'siege_pressure',team,
      commentary:pick([`Corner after corner! ${defTeam} cannot clear their lines!`,`Scrambles! Headers! Last-ditch blocks! Complete chaos in the box!`,`${defTeam} defending for their lives — bodies thrown at everything!`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'siege_chance',team,player:clutchName,
      commentary:pick([`${clutchName} RISES — blocked on the line! SO CLOSE!`,`${clutchName} fires — off the crossbar! AGONY!`,`${clutchName} gets a touch — agonisingly wide!`,`Half-chance for ${clutchName}! JUST over!`]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genManagerSentOffSeq=(min,managerName,refName,team)=>{
    const seq=[];
    seq.push({minute:min,type:'manager_protest',team,
      commentary:pick([`${managerName} STORMS toward the fourth official!`,`${managerName} is absolutely LIVID on the touchline!`,`${managerName} cannot contain himself — erupts from the technical area!`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'manager_warning',team,
      commentary:pick([`🟨 ${managerName} shown a yellow card! One more and he's in the stands!`,`${refName} issues a final warning to ${managerName}. He does not take it well.`,`${managerName} gets right in ${refName}'s face. Dangerous territory.`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'manager_sentoff',team,
      commentary:pick([`🟥 ${managerName} TO THE STANDS! ${refName} has seen enough!`,`🟥 INCREDIBLE! ${managerName} is DISMISSED! Ordered from the technical area!`,`🟥 ${managerName} GONE! He went too far and now he pays for it!`]),momentumChange:[0,0]});
    seq.push({minute:min,type:'manager_sentoff_reaction',team,
      commentary:pick([`${managerName} refuses to move. Coaching staff have to intervene.`,`${managerName} points at ${refName} as he leaves. Still furious.`,`The assistant takes the clipboard. The team looks rattled — and fired up.`,`${managerName} mouths something back from the tunnel entrance.`]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genComebackSeq=(min,scorer,captainName,team)=>{
    const seq=[];
    seq.push({minute:min,type:'comeback_eruption',team,player:scorer,
      commentary:pick([`📢 THE COMEBACK IS ON! ${team} have LIFE!`,`🔥 BELIEVE! ${scorer} and ${team} refuse to die!`,`⚡ FROM THE GRAVE! ${team} are BACK in this match!`,`🌋 ERUPTION! The stadium shakes — ${team} are coming!`]),momentumChange:[0,0]});
    if(captainName){
      seq.push({minute:min,type:'comeback_captain',team,player:captainName,
        commentary:pick([`${captainName} rallies — "WE GO AGAIN! ONE MORE!"`,`${captainName} runs to each teammate. Every single one. Eyes wild.`,`The captain's armband has never felt heavier. ${captainName} feels every gram.`,`${captainName}: "We've been here before. Finish it."`]),momentumChange:[0,0]});
    }
    seq.push({minute:min,type:'comeback_momentum',team,
      commentary:pick([`The atmosphere has completely transformed. ${team} sense it.`,`You could see the belief spreading through the ${team} players.`,`${team} looking like a different team suddenly. Unstoppable energy.`]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genCounterSeq=(min,counterPlayer,counterGk,counterTeam,supportPlayer)=>{
    const seq=[];
    seq.push({minute:min,type:'counter_start',team:counterTeam.shortName,player:counterPlayer.name,
      commentary:pick([
        `⚡ COUNTER ATTACK! ${counterPlayer.name} bursts forward at PACE!`,
        `💨 ${counterPlayer.name} GONE — the defence is wide OPEN!`,
        `🏃 LIGHTNING BREAK! ${counterPlayer.name} has acres of space!`,
        `⚡ Rapid counter-attack — ${counterPlayer.name} leads the charge!`,
      ]),momentumChange:[0,0]});
    if(supportPlayer&&supportPlayer.name!==counterPlayer.name&&Math.random()<0.55){
      seq.push({minute:min,type:'counter_pass',team:counterTeam.shortName,player:supportPlayer.name,
        commentary:pick([
          `${supportPlayer.name} feeds ${counterPlayer.name} in stride!`,
          `Quick touch from ${supportPlayer.name} — ${counterPlayer.name} still running!`,
          `${counterPlayer.name} combines with ${supportPlayer.name}! Beautiful!`,
        ]),momentumChange:[0,0]});
    }
    seq.push({minute:min,type:'counter_1v1',team:counterTeam.shortName,player:counterPlayer.name,
      commentary:pick([
        `ONE ON ONE! ${counterPlayer.name} faces ${counterGk?.name||'the keeper'}!`,
        `${counterPlayer.name} vs the last defender — THE CROWD RISES!`,
        `Just ${counterGk?.name||'the keeper'} to beat! Can ${counterPlayer.name} hold his nerve?!`,
      ]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genConfrontationSeq=(min,fouler,fouled,ref,addCard,foulerAgent,fouledAgent)=>{
    const seq=[];
    const refName=ref?.name||'The referee';
    const foulerAgg=foulerAgent?.personality===PERS.AGG;
    const fouledEmo=fouledAgent?.emotion;
    const openingComm=foulerAgg
      ?pick([`🔥 ${fouler?.name||'The player'} NOT BACKING DOWN — that's in his DNA!`,`😡 ${fouler?.name||'The aggressor'} steps right up. Nobody moves.`])
      :fouledEmo==='ecstatic'||fouledEmo==='angry'
        ?pick([`😤 ${fouled?.name||'The fouled player'} SNAPS — emotion pouring out!`,`🔥 ${fouled?.name||'The player'} has been waiting for this moment to boil over!`])
        :pick([`😤 ${fouled?.name||'The fouled player'} gets straight in ${fouler?.name||'his face'}!`,`🔥 TEMPERS FLARE! Players from BOTH sides flood the pitch!`,`😡 ${fouler?.name||'The player'} gets an absolute EARFUL!`,`🌪️ Total chaos — the tunnel empties!`]);
    seq.push({minute:min,type:'confrontation',commentary:openingComm,momentumChange:[0,0]});
    if(Math.random()<0.5){
      seq.push({minute:min,type:'confrontation_crowd',
        commentary:pick([
          `📢 The stadium erupts! Objects rain from the stands!`,
          `🌀 Absolute MAYHEM on the pitch — everyone is involved!`,
          `📣 Bench staff spill onto the touchline!`,
        ]),momentumChange:[0,0]});
    }
    if(addCard){
      seq.push({minute:min,type:'confrontation_card',player:fouled?.name||'',
        commentary:`🟨 ${fouled?.name||'A player'} booked for his reaction. Can't do that.`,
        momentumChange:[0,0]});
    }
    seq.push({minute:min,type:'confrontation_resolved',
      commentary:pick([
        `🫷 ${refName} restores order. Eventually.`,
        `📋 ${refName} separates the players. Writes extensively. Play resumes.`,
        `🤝 ${refName} holds firm — the game continues, barely.`,
      ]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genNearMissSeq=(min,player,gk,posTeam,defTeam)=>{
    const seq=[];
    seq.push({minute:min,type:'near_miss_setup',team:posTeam.shortName,player:player.name,
      commentary:pick([
        `🔥 ${player.name} FIRES — this looks dangerous!`,
        `${player.name} gets a shot away — direct at goal!`,
        `${player.name} shoots! ${gk?.name||'The keeper'} can only parry—`,
        `${player.name} drives it goalward — ${gk?.name||'The keeper'} beaten but—`,
        `${player.name} gets the strike away — it's going in... isn't it?`,
      ]),momentumChange:[0,0]});
    seq.push({minute:min,type:'near_miss_scramble',team:posTeam.shortName,
      commentary:pick([
        `🔥 SCRAMBLE IN THE BOX! Bodies everywhere — nobody can clear it!`,
        `Parried back out! ${defTeam.shortName} don't know where to look!`,
        `${gk?.name||'The keeper'} gets a hand to it — loose ball in a dangerous area!`,
        `Rebounds! Every touch could be a goal!`,
        `It's not cleared! Players diving in from all angles!`,
      ]),momentumChange:[0,0]});
    const cleared=Math.random()<0.6;
    seq.push({minute:min,type:'near_miss_end',team:posTeam.shortName,
      commentary:cleared
        ?pick([
          `Cleared off the line! ${defTeam.shortName} SURVIVE by inches!`,
          `Last-ditch block! ${defTeam.shortName} scramble it away — just!`,
          `BOOTED CLEAR! ${defTeam.shortName} breathe again. Barely.`,
          `Final body on the line — ${defTeam.shortName} ride that out!`,
          `${defTeam.shortName} survive the scramble! They'll know nothing about it.`,
        ])
        :pick([
          `${player.name} can't believe it — rolls agonisingly wide.`,
          `Rolling across the face of goal — and OUT! ${player.name} on his knees.`,
          `The whole bench had their arms up — just over the bar.`,
          `${player.name} gets a touch — but it creeps past the post!`,
          `Off the line... and out for a corner. ${player.name} stares at the sky.`,
        ]),momentumChange:[0,0]});
    return{sequence:seq};
  };

  const genPenaltySeq=(min,atk,def,team,defTeam,cardType,aim,gk,ctx={})=>{
    const seq=[];
    const incidents=[`💥 CONTACT! ${def.name} brings down ${atk.name} in the box!`,`⚠️ HANDBALL! ${def.name}'s arm is up... penalty!`,`🚨 CHALLENGE! ${def.name} lunges at ${atk.name}!`];
    seq.push({minute:min,type:'penalty_incident',commentary:pick(incidents),team:defTeam.shortName,momentumChange:[0,0]});
    if(cardType==='red'){seq.push({minute:min,type:'penalty_red_card',commentary:`🟥 RED CARD! ${def.name} is SENT OFF!`,team:defTeam.shortName,player:def.name,cardType:'red',momentumChange:[0,0]});seq.push({minute:min,type:'penalty_reaction',commentary:`😡 ${defTeam.shortName} furious! Chaos on the pitch!`,team:defTeam.shortName,momentumChange:[0,0]});}
    else if(cardType==='yellow'){seq.push({minute:min,type:'penalty_yellow_card',commentary:`🟨 Yellow card for ${def.name}.`,team:defTeam.shortName,player:def.name,cardType:'yellow',momentumChange:[0,0]});}
    const awarded=[`👉 PENALTY to ${team.shortName}!`,`🎯 NO DOUBT! Penalty awarded!`,`🚨 PENALTY! ${team.shortName} have a golden chance!`];
    seq.push({minute:min,type:'penalty_awarded',commentary:pick(awarded),team:team.shortName,momentumChange:[0,0]});
    let taker=atk;
    if(aim){const agents=aim.activeHomeAgents.concat(aim.activeAwayAgents);const takers=agents.filter(a=>a.canTakePenalty&&a.canTakePenalty()&&(a.player.name!==atk.name));if(takers.length){const best=takers.sort((a,b)=>(b.penaltyAbility||0)-(a.penaltyAbility||0))[0];taker=best.player;seq.push({minute:min,type:'penalty_taker_change',commentary:`👀 ${taker.name} takes the ball — designated taker steps forward.`,team:team.shortName,momentumChange:[0,0]});}}
    const tension=[`⏸️ ${taker.name} places the ball... the crowd holds its breath...`,`😰 Absolute silence in the stadium... ${taker.name} composes himself...`,`⚡ The tension is UNBEARABLE! Nobody is breathing!`];
    seq.push({minute:min,type:'penalty_tension',commentary:pick(tension),team:team.shortName,momentumChange:[0,0]});
    // Run-up
    seq.push({minute:min,type:'penalty_runup',commentary:pick([`${taker.name} begins his run-up...`,`Three steps back. ${taker.name} focuses.`,`${taker.name} eyes the corner. Steps forward.`]),team:team.shortName,momentumChange:[0,0]});
    // Resolve via unified system
    const takerAgent=aim?.getAgentByName(taker.name);
    const gkAgent=aim?.getAgentByName(gk?.name);
    const result=resolveContest(taker,takerAgent,gk||{},gkAgent,{type:'penalty',weather:aim?.weather});
    const scored=result.outcome==='goal';
    const outcomeComm=buildCommentary('penalty',{attacker:taker.name,defender:gk?.name||'the keeper'},result.outcome,result.flavour,ctx);
    seq.push({minute:min,type:'penalty_shot',commentary:outcomeComm,team:team.shortName,isGoal:scored,outcome:result.outcome,momentumChange:[0,0]});
    return{sequence:seq,isGoal:scored,outcomeCommentary:outcomeComm,penaltyTaker:taker,isRed:cardType==='red',isYellow:cardType==='yellow'};
  };

  const genSocial=(event,min,ms)=>{
    const posts=[];
    if(event.isGoal){
      const fan=event.team===ms.homeTeam.shortName?'@MarsUltra':'@SaturnSupporter';
      const opp=event.team===ms.homeTeam.shortName?'@SaturnSupporter':'@MarsUltra';
      posts.push({minute:min,user:fan,text:pick([`GOOOOAL! ${event.player}! 🔥`,`${event.player} SCORES! ⚽`,`GET IN! ${event.player}! 💪`]),likes:rndI(200,1500),retweets:rndI(80,400)});
      posts.push({minute:min,user:opp,text:pick(['Devastating...','Wake up defense!','Not good enough! 💢']),likes:rndI(100,600),retweets:rndI(30,150)});
      if(Math.random()<0.6)posts.push({minute:min,user:'@ISL_Updates',text:`⚽ GOAL! ${event.player} (${min}')`,likes:rndI(500,2000),retweets:rndI(150,600)});
    }
    if(event.isControversial)posts.push({minute:min,user:'@GalacticFootyFan',text:pick(['⚠️ ROBBERY! That\'s NEVER a penalty! 😡','CORRUPTION! 💸','Are you KIDDING?! Disgraceful!']),likes:rndI(800,3000),retweets:rndI(300,1200)});
    if(event.cardType==='red')posts.push({minute:min,user:'@CosmicFootyNews',text:`🟥 BREAKING: ${event.foulerName||event.player} SENT OFF! 10 men!`,likes:rndI(500,2000),retweets:rndI(200,700)});
    return posts;
  };

  const genEvent=(min,homeTeam,awayTeam,momentum,possession,playerStats,score,activePlayers,substitutionsUsed,aiInfluence,aim,chaosLevel=0,lastEventType=null)=>{
    if(Math.random()>0.35)return null;

    // --- Weather modifiers ---
    const wx=aim?.weather;
    const wxGkPen   = wx===WX.MAG   ? 25 : 0;   // magnetic storm: GK gloves malfunction
    const wxStatPen = wx===WX.SOLAR ? 15 : 0;   // solar flare: all rolls reduced
    const wxShotBoost = wx===WX.ZERO ? 0.10 : 0; // zero gravity: more shot chances
    const wxDustFail  = wx===WX.DUST ? 12 : 0;   // dust storm: passing harder

    // --- Chaos events (blaseball energy: the game admits something is wrong) ---
    if(chaosLevel>70&&Math.random()<0.04){
      const refName=aim?.referee?.name||'The referee';
      const CHAOS=[
        `⚡ COSMIC ANOMALY detected at pitch level. The match continues regardless.`,
        `🌌 ${refName} consults their notes. The notes contain only the word "SOON".`,
        `🪐 A nearby planetary alignment scrambles all comms for four seconds. Everyone keeps playing.`,
        `🔮 The stadium announcer reads from a prepared card: "This was always going to happen."`,
        `⚡ A player briefly occupies two positions simultaneously. VAR is unavailable in this galaxy.`,
        `👁️ Someone in the crowd knows something. They are not saying anything.`,
        `🌀 The pitch tilts ${rndI(1,8)}° for exactly one minute. Officials log it as "acceptable variance".`,
      ];
      return{minute:min,type:'chaos_event',team:pick([homeTeam,awayTeam]).shortName,commentary:pick(CHAOS),momentumChange:[0,0],isChaos:true};
    }

    const posTeam=Math.random()*100<possession[0]?homeTeam:awayTeam;
    const defTeam=posTeam===homeTeam?awayTeam:homeTeam;
    const isHome=posTeam===homeTeam;
    const posActive=isHome?activePlayers.home:activePlayers.away;
    const defActive=isHome?activePlayers.away:activePlayers.home;
    const scoreDiff=isHome?(score[0]-score[1]):(score[1]-score[0]);
    const phase=min<=25?'early':min<=65?'midgame':min<=82?'late':'dying';
    const matchCtx=(pName)=>({min,scoreDiff,playerGoals:playerStats[pName]?.goals||0});

    // --- Roll with momentum + weather + chain modifiers ---
    const momTeam=isHome?momentum[0]:momentum[1];
    const momBoost=momTeam>5?0.08:momTeam>3?0.04:0;
    const chainBoost=lastEventType==='shot'?0.04:lastEventType==='corner'?0.02:0;
    let roll=Math.max(0,Math.random()-momBoost-chainBoost-wxShotBoost);
    if(aiInfluence){const td=isHome?aiInfluence.home:aiInfluence.away;if(td.SHOOT>3)roll*=0.7;if(td.ATTACK>5)roll*=0.8;}
    if(scoreDiff<0&&min>=80)roll*=0.5;

    // --- Personality-driven events (12%) ---
    if(aim&&Math.random()<0.12){
      const agents=isHome?aim.activeHomeAgents:aim.activeAwayAgents;
      const agent=pick(agents.filter(a=>a.fatigue<95));
      if(agent){
        if(agent.personality===PERS.AGG&&Math.random()<0.4){
          const card=aim.shouldGiveCard(60+Math.random()*40);
          const aggComm=card==='red'
            ?pick([`🟥 ${agent.player.name} goes in TWO-FOOTED! Straight red, no debate!`,`🟥 VIOLENT CONDUCT! ${agent.player.name} is GONE!`])
            :card==='yellow'
            ?pick([`🟨 ${agent.player.name} goes in hard — booked!`,`🟨 Reckless from ${agent.player.name}. Lucky it's only yellow.`])
            :pick([`Crunching tackle from ${agent.player.name}! Ref lets it go.`,`${agent.player.name} leaves a mark. No card — just pain.`]);
          return{minute:min,type:'foul',team:posTeam.shortName,player:agent.player.name,cardType:card,commentary:aggComm,isPersonalityEvent:true,momentumChange:card?[3,-5]:[2,-2]};
        }
        if(agent.personality===PERS.SEL&&agent.player.position==='FW'&&Math.random()<0.3)
          return{minute:min,type:'shot',team:posTeam.shortName,player:agent.player.name,outcome:'miss',commentary:pick([`${agent.player.name} shoots from distance... WAY OVER! Selfish!`,`${agent.player.name} ignores three open teammates. Blazes over.`,`SELFISH! ${agent.player.name} had options. Chose glory. Found none.`,`${agent.player.name} tries his luck from 40 yards. No.`]),isPersonalityEvent:true,momentumChange:[-3,2]};
        if(agent.personality===PERS.CRE&&Math.random()<0.25){
          const win=Math.random()<0.3;
          return{minute:min,type:win?'goal':'creative_fail',team:posTeam.shortName,player:agent.player.name,outcome:win?'goal':'miss',isGoal:win,
            commentary:win
              ?pick([`${agent.player.name} tries something OUTRAGEOUS... WHAT A GOAL! ✨🚀`,`${agent.player.name} — a move nobody has attempted in this solar system. And it WORKS.`,`SCORPION KICK? BACKHEEL? Nobody agrees. The ball is in. That's all that matters. ✨`])
              :pick([`${agent.player.name} loses the ball! Too creative by half.`,`Visionary or reckless? Today: reckless. ${agent.player.name} gives it away.`,`${agent.player.name} attempts the impossible. The impossible wins.`]),
            isPersonalityEvent:true,momentumChange:win?[15,-10]:[-2,3]};
        }
        if(agent.personality===PERS.LAZ&&agent.fatigue>50&&Math.random()<0.2){
          agent.fatigue-=5;
          return{minute:min,type:'lazy_moment',team:posTeam.shortName,player:agent.player.name,commentary:pick([`${agent.player.name} has stopped running. Nobody is surprised.`,`${agent.player.name} takes a moment to appreciate the view. Mid-match.`,`Tactical stroll from ${agent.player.name}. The manager is apoplectic.`,`${agent.player.name} jogs while everyone else sprints. Classic.`]),isPersonalityEvent:true,momentumChange:[-2,4]};
        }
        if(agent.personality===PERS.WRK&&agent.fatigue>70&&Math.random()<0.25){
          agent.fatigue+=5;
          return{minute:min,type:'workhorse_tackle',team:posTeam.shortName,player:agent.player.name,commentary:pick([`${agent.player.name} is EVERYWHERE despite exhaustion! 💪`,`Running on fumes — ${agent.player.name} refuses to stop!`,`${agent.player.name}: how is this person still running?! 💪`,`${agent.player.name} makes their 14th tackle. On fumes. Incredible.`]),isPersonalityEvent:true,momentumChange:[5,-3]};
        }
        if(agent.personality===PERS.TEAM&&Math.random()<0.12){
          const fw=agents.find(a=>a!==agent&&a.player.position==='FW');
          if(fw){
            const goal=Math.random()<0.4;
            return{minute:min,type:'shot',team:posTeam.shortName,player:fw.player.name,assister:agent.player.name,outcome:goal?'goal':'save',isGoal:goal,
              commentary:goal
                ?pick([`Beautiful from ${agent.player.name}! ${fw.player.name} finishes! ⚽`,`ASSISTS ARE AN ART FORM. ${agent.player.name} proves it. ${fw.player.name} tucks it away!`])
                :pick([`Unselfish ball from ${agent.player.name}! ${fw.player.name} denied!`,`${agent.player.name} finds ${fw.player.name}... great save keeps it out!`]),
              isPersonalityEvent:true,momentumChange:goal?[12,-8]:[3,-2]};
          }
        }
        if(agent.personality===PERS.CAU&&Math.random()<0.15){
          return{minute:min,type:'defense',team:posTeam.shortName,player:agent.player.name,outcome:'success',commentary:pick([`${agent.player.name} holds their position. Quietly effective.`,`${agent.player.name} snuffs out the threat before it starts.`,`No heroics from ${agent.player.name} — just the right play.`]),isPersonalityEvent:true,momentumChange:isHome?[0,-1]:[-1,0]};
        }
      }
    }

    // --- Controversy events (3%) ---
    if(aim&&Math.random()<0.03){
      const type=pick(['missed_penalty','wrong_penalty','missed_foul']);
      if(type==='wrong_penalty')return{minute:min,type:'penalty',team:posTeam.shortName,isPenalty:true,commentary:pick([`⚠️ CONTROVERSY! ${aim.referee.name} points to the spot... that is NEVER a penalty!`,`⚠️ What is ${aim.referee.name} DOING?! Nobody touched him!`,`⚠️ Penalty given! The away bench erupts! This is outrageous!`]),isControversial:true,momentumChange:[8,-12]};
      if(type==='missed_penalty')return{minute:min,type:'missed_penalty_call',team:posTeam.shortName,commentary:pick([`⚠️ PENALTY SHOUT! ${aim.referee.name} waves it away — disgraceful!`,`⚠️ Clear foul in the box! ${aim.referee.name} unmoved. Astonishing.`,`⚠️ HOW IS THAT NOT A PENALTY?! Arms everywhere!`]),isControversial:true,momentumChange:[-5,5]};
    }

    // --- Standard event branches ---
    let player,defender,outcome,commentary,momentumChange=[0,0];

    if(roll<0.05){
      // FOUL / CARD / PENALTY
      player=getPlayer(defTeam,defActive,'defending');
      const atk=getPlayer(posTeam,posActive,'attacking');
      if(!player||!atk)return null;
      const inBox=Math.random()<0.15;
      const sev=rnd(0,100);
      let card=aim?aim.shouldGiveCard(sev):(sev>85?'red':sev>60?'yellow':null);
      if(card==='yellow'&&playerStats[player.name]?.yellowCard)card='red';
      if(inBox){
        const penGk=getPlayer(defTeam,defActive,'defending','GK');
        const pseq=genPenaltySeq(min,atk,player,posTeam,defTeam,card,aim,penGk,matchCtx(atk.name));
        return{minute:min,type:'penalty_sequence',team:posTeam.shortName,
          player:pseq.penaltyTaker.name,   // taker → goal credit
          foulerName:player.name,          // fouler → card credit
          foulerTeam:defTeam.shortName,    // fouler's team → for active player removal
          defender:penGk?.name,
          outcome:pseq.isGoal?'goal':'saved',
          commentary:pseq.outcomeCommentary,
          momentumChange:isHome?[pseq.isGoal?6:1,0]:[0,pseq.isGoal?6:1],
          cardType:card,isPenalty:true,isGoal:pseq.isGoal,
          animation:pseq.isGoal?{type:'goal',color:posTeam.color}:null,
          penaltySequence:pseq.sequence,penaltyTaker:pseq.penaltyTaker,
          isRedCard:pseq.isRed,isYellowCard:pseq.isYellow};
      }
      commentary=card==='red'
        ?pick([`🟥 RED CARD! ${player.name} is SENT OFF!`,`🟥 STRAIGHT RED! ${player.name} — see you in the tunnel!`,`🟥 ${player.name} GONE! Incredible scenes!`])
        :card==='yellow'
        ?pick([`🟨 ${player.name} booked for a foul on ${atk.name}`,`🟨 Yellow card — ${player.name} won't be happy.`,`🟨 ${player.name}: reckless challenge. Booked.`])
        :pick([`Foul by ${player.name} on ${atk.name}. Free kick.`,`${player.name} brings down ${atk.name}.`,`Clumsy foul from ${player.name}.`,`${player.name} clips ${atk.name}. Ref blows.`]);
      momentumChange=isHome?[1,0]:[0,1];if(card==='red')momentumChange=isHome?[2,0]:[0,2];
      const foulEvt={minute:min,type:'foul',team:defTeam.shortName,player:player.name,outcome:card||'foul',commentary,momentumChange:[0,0],cardType:card};
      // Red card sparks a confrontation
      if(card==='red'&&Math.random()<0.40){
        const cSeq=genConfrontationSeq(min,player,atk,aim?.referee,Math.random()<0.25,aim?.getAgentByName(player.name),aim?.getAgentByName(atk.name));
        return{...foulEvt,momentumChange:isHome?[2,0]:[0,2],confrontationSequence:cSeq.sequence};
      }
      // Outside box: free kick sequence (50% chance, not for red cards which already have confrontation)
      if(card!=='red'&&Math.random()<0.50){
        const fkTaker=getPlayer(posTeam,posActive,'technical')||atk;
        const fkGk=getPlayer(defTeam,defActive,'defending','GK');
        const fkSeq=genFreekickSeq(min,fkTaker,fkGk,posTeam,defTeam,aim,matchCtx(fkTaker.name));
        return{minute:min,type:'freekick_sequence',team:posTeam.shortName,
          player:fkTaker.name,foulerName:player.name,foulerTeam:defTeam.shortName,
          cardType:card,isGoal:fkSeq.isGoal,outcome:fkSeq.isGoal?'goal':'miss',
          commentary:fkSeq.outcomeCommentary,
          animation:fkSeq.isGoal?{type:'goal',color:posTeam.color}:null,
          momentumChange:isHome?[fkSeq.isGoal?6:1,0]:[0,fkSeq.isGoal?6:1],
          freekickSequence:[foulEvt,...fkSeq.sequence]};
      }
      momentumChange=isHome?[1,0]:[0,1];
      return{...foulEvt,momentumChange};
    }

    if(roll<0.20){
      // SHOT — with full agent stat integration
      player=getPlayer(posTeam,posActive,'attacking','FW')||getPlayer(posTeam,posActive,'attacking');
      const gk=getPlayer(defTeam,defActive,'defending','GK');
      if(!player||!gk)return null;

      // 18% of shot events: long-range speculative effort
      if(Math.random()<0.18){
        const lsNet=(player.technical||70)*0.4+(player.mental||70)*0.3+rnd(-20,20)-(gk.defending||70)*0.8-18;
        const lsGoal=lsNet>28;
        const lsComm=lsGoal
          ?pick([`⚽ FROM DISTANCE! ${player.name} unleashes an ABSOLUTE THUNDERBOLT!`,`⚽ YOU ARE JOKING! ${player.name} — from 40 yards! That is a WONDER GOAL!`,`⚽ ${player.name} shoots from RANGE — it flies into the TOP CORNER! The stadium erupts!`,`⚽ OUTRAGEOUS! ${player.name} scores from DISTANCE! Nobody saw that coming!`])
          :pick([`${player.name} tries his luck from range — well held by ${gk.name}.`,`Speculative from ${player.name}! Drifts past the post.`,`${player.name} has a go from 35 yards — comfortably saved.`,`Ambitious from ${player.name}! Long-range effort straight at the keeper.`,`${player.name} strikes from distance — skews wide. Worth a try.`]);
        return{minute:min,type:'long_shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:lsGoal?'goal':'miss',isGoal:lsGoal,commentary:lsComm,momentumChange:isHome?[lsGoal?5:1,0]:[0,lsGoal?5:1],animation:lsGoal?{type:'goal',color:posTeam.color}:null};
      }

      const shooterAgent=aim?.getAgentByName(player.name);
      const gkAgent=aim?.getAgentByName(gk.name);
      const isClutchMoment=shooterAgent?.isClutch&&min>=80&&Math.abs(score[0]-score[1])<=1;
      // Unified contest resolution
      const shotResult=resolveContest(player,shooterAgent,gk,gkAgent,{type:'shot',weather:wx,isClutch:isClutchMoment});
      // Apply form bonus to net (resolveContest doesn't know about per-match form)
      const formAdj=formBonus(player.name,playerStats)-formBonus(gk.name,playerStats)+(aim?.getAgentByName(player.name)?.getDecisionBonus()||0)-wxStatPen+wxGkPen;
      const net=shotResult.margin+formAdj;
      const shotFlavour=shotResult.flavour;

      // Own goal
      if(net>10&&Math.random()<0.05){
        outcome='own_goal';
        commentary=pick([`😱 OWN GOAL! ${gk.name} fumbles it in!`,`😱 CATASTROPHE! ${gk.name} puts it past his own keeper!`,`😱 Oh no — own goal from ${gk.name}!`]);
        return{minute:min,type:'shot',team:defTeam.shortName,player:gk.name,outcome,commentary,momentumChange:isHome?[-5,5]:[5,-5],isGoal:true,animation:{type:'goal',color:defTeam.color}};
      }
      // Zero gravity: near-miss curves back in
      if(wx===WX.ZERO&&net>5&&net<=15&&Math.random()<0.28){
        return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:'goal',commentary:pick([`⚽ ${player.name}'s shot drifts WIDE... then curves back in! ZERO GRAVITY GOAL! 🌌`,`⚽ ORBITAL! The ball escapes the atmosphere — and comes back IN! ${player.name}! 🌌`]),momentumChange:isHome?[5,0]:[0,5],isGoal:true,animation:{type:'goal',color:posTeam.color},isWeatherGoal:true};
      }
      if(net>15){
        commentary=buildCommentary('shot',{attacker:player.name,defender:gk.name},'goal',shotFlavour,matchCtx(player.name));
        return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,assister:null,outcome:'goal',commentary,momentumChange:isHome?[5,0]:[0,5],isGoal:true,isClutchGoal:isClutchMoment,animation:{type:'goal',color:posTeam.color}};
      }
      if(net>5){
        // Near-miss sequence: parry + scramble (20% of saves — more dramatic than just 'saved')
        if(Math.random()<0.20){
          const nmSeq=genNearMissSeq(min,player,gk,posTeam,defTeam);
          return{minute:min,type:'near_miss_sequence',team:posTeam.shortName,player:player.name,outcome:'near_miss',commentary:nmSeq.sequence[nmSeq.sequence.length-1].commentary,momentumChange:isHome?[2,0]:[0,2],nearMissSequence:nmSeq.sequence};
        }
        // Magnetic storm: gloves malfunction, save becomes goal
        if(wx===WX.MAG&&Math.random()<0.28){
          return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:'goal',commentary:pick([`⚽ ${gk.name}'s gloves MALFUNCTION in the magnetic storm! It rolls in! 🧲`,`⚽ MAGNETIC INTERFERENCE! ${gk.name} drops it — ${player.name} can't believe it! 🧲`]),momentumChange:isHome?[5,0]:[0,5],isGoal:true,animation:{type:'goal',color:posTeam.color},isWeatherGoal:true};
        }
        const saveComm=buildCommentary('shot',{attacker:player.name,defender:gk.name},'saved',shotFlavour,matchCtx(player.name));
        // Counter-attack: the saving team transitions forward
        if(Math.random()<0.20){
          const cPlayer=getPlayer(defTeam,defActive,'athletic');
          const cSupport=getPlayer(defTeam,defActive,'technical');
          const cGk=getPlayer(posTeam,posActive,'defending','GK');
          if(cPlayer&&cGk){
            const cSeq=genCounterSeq(min,cPlayer,cGk,defTeam,cSupport);
            const cAtkAgent=aim?.getAgentByName(cPlayer.name);
            const cGkAgent=aim?.getAgentByName(cGk.name);
            const cIsClutch=cAtkAgent?.isClutch&&min>=80;
            const cResult=resolveContest(cPlayer,cAtkAgent,cGk,cGkAgent,{type:'shot',weather:wx,isClutch:cIsClutch});
            const cGoal=cResult.outcome==='goal';
            const cIsHome=defTeam===homeTeam;
            const savedSeqEvt={minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:'saved',commentary:saveComm,momentumChange:[0,0]};
            const cComm=buildCommentary('shot',{attacker:cPlayer.name,defender:cGk.name},cResult.outcome,cResult.flavour,matchCtx(cPlayer.name));
            return{minute:min,type:'counter_sequence',team:defTeam.shortName,player:cPlayer.name,outcome:cGoal?'goal':'saved',isGoal:cGoal,commentary:cComm,momentumChange:cIsHome?[cGoal?8:-1,0]:[0,cGoal?8:-1],animation:cGoal?{type:'goal',color:defTeam.color}:null,counterSequence:[savedSeqEvt,...cSeq.sequence]};
          }
        }
        return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:'saved',commentary:saveComm,momentumChange:isHome?[2,0]:[0,2],animation:{type:'saved',color:defTeam.color}};
      }
      // Miss — solar weather override, otherwise stat-reactive
      const missComm=wx===WX.SOLAR&&Math.random()<0.4
        ?pick([`${player.name} fires — BLINDED by the solar flare! Miles off!`,`${player.name} can barely see through the plasma discharge. Shot wide.`])
        :buildCommentary('shot',{attacker:player.name,defender:gk.name},'miss',shotFlavour,matchCtx(player.name));
      return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome:'miss',commentary:missComm,momentumChange:isHome?[1,0]:[0,1]};
    }

    if(roll<0.40){
      // ATTACK / DRIBBLE
      player=getPlayer(posTeam,posActive,'attacking');
      defender=getPlayer(defTeam,defActive,'defending');
      if(!player||!defender)return null;
      const net=player.attacking*0.7+player.athletic*0.3+rnd(-15,15)-(defender.defending*0.7+defender.athletic*0.3+rnd(-15,15));
      if(net>20){
        // Skill moment: 22% chance of individual highlight instead of generic breakthrough
        if(Math.random()<0.22){
          const skills=['rabona','nutmeg','elastico','heel flick','step-over sequence','Cruyff turn','shoulder drop'];
          const skill=pick(skills);
          return{minute:min,type:'skill_moment',team:posTeam.shortName,player:player.name,defender:defender.name,
            commentary:pick([
              `✨ ${player.name} with the ${skill}! ${defender.name} absolutely FROZEN! The crowd erupts!`,
              `✨ MAGIC from ${player.name}! The ${skill} leaves ${defender.name} in another dimension!`,
              `✨ Ooh! ${player.name} — ${skill}! The cheer is IMMEDIATE!`,
              `✨ Did you see THAT? ${player.name} with the ${skill} — ${defender.name} doesn't know which way he went!`,
              `✨ ${player.name} shows off the full repertoire — ${skill} — and ${defender.name} is on the floor!`,
            ]),momentumChange:isHome?[3,0]:[0,3]};
        }
        outcome='breakthrough';
        commentary=pick([
          phase==='dying'&&`${player.name} SURGES FORWARD in injury time! The whole stadium on its feet!`,
          scoreDiff<0&&`${player.name} DRIVES at the defence — they NEED something here!`,
          `${player.name} BREAKS THROUGH! Surging run!`,
          `${player.name} is in on goal! DANGER!`,
          `${player.name} splits the defence! 1-on-1!`,
          `Nobody catching ${player.name} now! Sensational pace!`,
          `${player.name} gone clear! The defence appeals in vain!`,
          `${player.name} found a crack — and burst right through it!`,
          `${player.name} leaves three defenders in his wake — UNSTOPPABLE!`,
          `Space opened up. ${player.name} was there to exploit it immediately.`,
          `That is a devastating run! ${player.name} in FULL FLIGHT!`,
        ].filter(Boolean));
        momentumChange=isHome?[3,0]:[0,3];
      } else if(net>0){
        outcome='success';
        commentary=pick([
          `${player.name} advances past ${defender.name}`,
          `${player.name} beats ${defender.name}`,
          `Neat skill from ${player.name}`,
          `${player.name} ghosts past ${defender.name}`,
          `${player.name} with a clever touch — past ${defender.name}.`,
          `${defender.name} had him closed down — ${player.name} found a way through.`,
          `Clever from ${player.name} — draws the defender and slips by.`,
          `${player.name} holds off ${defender.name} and drives forward.`,
        ]);
        momentumChange=isHome?[1,0]:[0,1];
      } else {
        outcome='intercepted';
        commentary=pick([
          `${defender.name} intercepts ${player.name}`,
          `${defender.name} reads it perfectly`,
          `Great positioning from ${defender.name}`,
          `${player.name} runs into a wall — ${defender.name} is immovable`,
          `${defender.name} was always going to win that — brilliant reading of the game.`,
          `${player.name} tried to force it — ${defender.name} had it read all along.`,
          `${defender.name} closes down brilliantly — no room for ${player.name}.`,
        ]);
        momentumChange=isHome?[-1,0]:[0,-1];
        // Interception can spark a counter
        if(Math.random()<0.15){
          const cPlayer=getPlayer(defTeam,defActive,'athletic');
          const cSupport=getPlayer(defTeam,defActive,'technical');
          const cGk=getPlayer(posTeam,posActive,'defending','GK');
          if(cPlayer&&cGk){
            const cSeq=genCounterSeq(min,cPlayer,cGk,defTeam,cSupport);
            const cAtkAgent2=aim?.getAgentByName(cPlayer.name);
            const cGkAgent2=aim?.getAgentByName(cGk.name);
            const cResult2=resolveContest(cPlayer,cAtkAgent2,cGk,cGkAgent2,{type:'shot',weather:wx});
            const cGoal=cResult2.outcome==='goal';
            const cIsHome=defTeam===homeTeam;
            const intEvt={minute:min,type:'attack',team:posTeam.shortName,player:player.name,defender:defender.name,outcome:'intercepted',commentary,momentumChange:[0,0]};
            const cComm=buildCommentary('shot',{attacker:cPlayer.name,defender:cGk.name},cResult2.outcome,cResult2.flavour,matchCtx(cPlayer.name));
            return{minute:min,type:'counter_sequence',team:defTeam.shortName,player:cPlayer.name,outcome:cGoal?'goal':'saved',isGoal:cGoal,commentary:cComm,momentumChange:cIsHome?[cGoal?8:-1,0]:[0,cGoal?8:-1],animation:cGoal?{type:'goal',color:defTeam.color}:null,counterSequence:[intEvt,...cSeq.sequence]};
          }
        }
      }
      return{minute:min,type:'attack',team:posTeam.shortName,player:player.name,defender:defender.name,outcome,commentary,momentumChange};
    }

    if(roll<0.48){
      // CORNER
      player=getPlayer(posTeam,posActive,'technical');
      const gk=getPlayer(defTeam,defActive,'defending','GK');
      const header=getPlayer(posTeam,posActive,'athletic');
      if(!player||!gk||!header)return null;
      const net=header.attacking*0.5+header.athletic*0.5+rnd(-20,20)-(gk.defending*0.7+gk.athletic*0.3+rnd(-20,20))-wxGkPen;
      if(net>20){
        outcome='goal';
        commentary=pick([
          phase==='dying'&&`⚽ CORNER — AND IT'S IN! ${header.name} with a DRAMATIC late header!`,
          `⚽ GOAL! ${header.name} heads in from the corner!`,
          `⚽ ${header.name} POWERS home the header!`,
          `⚽ CORNER CONVERTED! ${header.name} rises highest!`,
          `⚽ ${header.name} meets it perfectly — GOAL!`,
          `⚽ From the corner — header — GOAL! ${header.name} all alone at the back post!`,
          `⚽ ${player.name}'s delivery is perfect — ${header.name} doesn't even need to jump!`,
          `⚽ Set-piece delivery — ${header.name} at the far post — SCORE!`,
        ].filter(Boolean));
        return{minute:min,type:'corner_goal',team:posTeam.shortName,player:header.name,outcome,commentary,momentumChange:isHome?[3,0]:[0,3],isGoal:true,animation:{type:'goal',color:posTeam.color}};
      }
      if(net>10){
        outcome='saved';
        commentary=pick([
          `Corner from ${player.name}! ${gk.name} punches clear!`,
          `${gk.name} claims the corner confidently!`,
          `Dangerous delivery — ${gk.name} tips it away!`,
          `${gk.name} gets a fist to it!`,
          `${gk.name} rises above the crowd — catches it cleanly. Comfortable.`,
          `Corner well-taken — but ${gk.name} was always going to claim it.`,
          `${gk.name} punches under pressure! The defence relieved.`,
        ]);
        return{minute:min,type:'corner',team:posTeam.shortName,player:player.name,defender:gk.name,outcome,commentary,momentumChange:isHome?[1,0]:[0,1]};
      }
      outcome='cleared';
      commentary=pick([
        `Corner kick cleared by ${defTeam.shortName}`,
        `Headed away! ${defTeam.shortName} survive`,
        `${defTeam.shortName} scramble it clear!`,
        `Blocked! ${defTeam.shortName} hold firm`,
        `Punched clear — hacked away! ${defTeam.shortName} ride the pressure.`,
        `Out for a throw. Corner comes to nothing.`,
        `${defTeam.shortName} bodies on the line — cleared!`,
      ]);
      momentumChange=[0,0];

    } else if(roll<0.52){
      // INJURY
      player=Math.random()<0.5?getPlayer(posTeam,posActive,'athletic'):getPlayer(defTeam,defActive,'athletic');
      if(!player)return null;
      const inHome=posActive.includes(player.name);
      const tm=inHome?posTeam:defTeam;
      // Injury scare (30%): player goes down but gets back up — no substitution
      if(Math.random()<0.30){
        return{minute:min,type:'injury_scare',team:tm.shortName,player:player.name,
          commentary:pick([
            `😬 ${player.name} goes down clutching his leg... everybody stops. Physio sprints on.`,
            `⚠️ ${player.name} takes a knock — waves the physio away. Brave soul.`,
            `😬 ${player.name} is down! Tense few moments... but he's back on his feet.`,
            `${player.name} pulls up momentarily — plays on. Relief all round.`,
            `⚠️ ${player.name} stumbles — the crowd holds its breath. He's okay. Play continues.`,
            `😬 Collision! ${player.name} needs treatment... thank goodness, he's back up.`,
          ]),momentumChange:[0,0]};
      }
      commentary=wx===WX.PLASMA&&Math.random()<0.5
        ?pick([`${player.name} collapses! The plasma winds have taken their toll!`,`${player.name} is DOWN — plasma exposure? Medics sprint on!`])
        :pick([
          `${player.name} is down injured! Medics on!`,
          `${player.name} pulls up! Looks serious.`,
          `${player.name} takes a knock — stays down.`,
          `${player.name} is in trouble. Trainer called onto the pitch.`,
          `${player.name} writhes in pain — this looks bad.`,
          `All play stops. ${player.name} needs attention.`,
        ]);
      return{minute:min,type:'injury',team:tm.shortName,player:player.name,outcome:'injured',commentary,momentumChange:[0,0],isInjury:true};

    } else if(roll<0.70){
      // DEFENSE / TACKLE
      defender=getPlayer(defTeam,defActive,'defending','DF');
      player=getPlayer(posTeam,posActive,'attacking');
      if(!defender||!player)return null;
      const net=(defender.defending+defender.athletic)/2+rnd(-20,20)-((player.technical+player.athletic)/2+rnd(-20,20));
      if(net>20){
        outcome='clean_tackle';
        commentary=pick([
          phase==='dying'&&`VITAL TACKLE! ${defender.name} denies ${player.name} with everything he has!`,
          `Perfect tackle from ${defender.name}!`,
          `${defender.name} THUNDERS in! Ball won cleanly!`,
          `Textbook defending from ${defender.name}!`,
          `${defender.name} times it perfectly — ball and all!`,
          `LAST DITCH! ${defender.name} slides in and takes the ball cleanly!`,
          `${defender.name} — a masterclass in defending. Never in doubt.`,
          `Superb from ${defender.name} — anticipates the pass and nicks it!`,
          `${defender.name} absolutely dominates ${player.name} in that challenge.`,
        ].filter(Boolean));
        momentumChange=isHome?[0,-2]:[-2,0];
      } else if(net>0){
        outcome='success';
        commentary=pick([
          `${defender.name} wins the ball`,
          `${defender.name} gets in the way`,
          `Solid defensive work from ${defender.name}`,
          `${defender.name} holds his ground`,
          `${defender.name} positioned well — gets a foot in.`,
          `Good awareness from ${defender.name} — clears the danger.`,
          `${defender.name} with a quiet, effective intervention.`,
        ]);
        momentumChange=isHome?[0,-1]:[-1,0];
      } else {
        outcome='failed';
        commentary=pick([
          `${player.name} evades ${defender.name}`,
          `${player.name} dances past ${defender.name}`,
          `${player.name} leaves ${defender.name} for dead`,
          `${defender.name} dives in — ${player.name} skips away`,
          `${defender.name} had no answer — ${player.name} too quick.`,
          `${player.name} — too sharp. ${defender.name} can only watch.`,
          `${player.name} feints — ${defender.name} commits — gone.`,
        ]);
        momentumChange=isHome?[1,0]:[0,1];
      }
      return{minute:min,type:'defense',team:defTeam.shortName,player:defender.name,defender:player.name,outcome,commentary,momentumChange};

    } else {
      // PASSING / POSSESSION
      player=getPlayer(posTeam,posActive,'technical');
      defender=getPlayer(defTeam,defActive,'defending');
      if(!player||!defender)return null;
      const net=(player.technical+player.mental)/2+rnd(-20,20)-((defender.defending+defender.mental)/2+rnd(-20,20))-(wxStatPen*0.5);
      const dustThreshold=-10+wxDustFail;

      // GK distribution (15% of possession events)
      if(Math.random()<0.15){
        const distGk=getPlayer(posTeam,posActive,'defending','GK');
        if(distGk){
          const isLong=Math.random()<0.4;
          const distTarget=getPlayer(posTeam,posActive,'technical');
          return{minute:min,type:'gk_distribution',team:posTeam.shortName,player:distGk.name,
            commentary:isLong
              ?pick([`${distGk.name} launches it long — punts it deep into the mixer.`,`Long ball from ${distGk.name}! Bypassing the press entirely.`,`${distGk.name} drives a goal kick forward — looking for the target man.`])
              :pick([`${distGk.name} plays it short — building patiently from the back.`,`${distGk.name} rolls it out to the full-back. Calm head.`,`${distGk.name} distributes confidently to ${distTarget?.name||'a teammate'}. Under no pressure.`]),
            momentumChange:[0,0]};
        }
      }

      // Atmosphere moment (8% of possession events, less in dying phase)
      if(Math.random()<0.08&&phase!=='dying'){
        const atmComms=[
          phase==='early'&&`📣 Still early — but the atmosphere is already building. Both sets of fans finding their voice.`,
          phase==='midgame'&&Math.abs(scoreDiff)===0&&`📣 All square and the crowd is RIGHT into this. Every touch greeted with noise.`,
          phase==='late'&&`📣 The atmosphere has shifted. You can feel it. Something is building here.`,
          `📣 A chant ripples around the stadium — both ends now in full voice.`,
          `📣 Flags waving in the away end. The visitors are making themselves heard.`,
          `🎵 Low hum turning into a roar. The crowd can sense something brewing.`,
          `📣 The announcer reads out a score from another game. Groans from one side. Cheers from the other.`,
          `📣 The crowd collectively holds its breath on every touch now. The tension is building.`,
          `🎵 An old terrace chant starts somewhere up in the stands. Spreads. Everyone joins in.`,
        ].filter(Boolean);
        return{minute:min,type:'atmosphere_moment',team:posTeam.shortName,commentary:pick(atmComms),momentumChange:[0,0]};
      }

      if(net>10){
        outcome='good_pass';
        commentary=pick([
          phase==='early'&&`${player.name} with an early probe through the lines. Testing the shape.`,
          scoreDiff>1&&`${player.name} keeping it — no risks needed. The lead is comfortable.`,
          `${player.name} with a precise pass`,
          `${player.name} picks out a teammate`,
          `${player.name} plays it through the lines`,
          `Neat footwork from ${player.name}`,
          `${player.name} finds space and uses it`,
          `Lovely touch from ${player.name} — the move continues.`,
          `${player.name} plays the one-two — comes out the other side.`,
          `Sharp combination — ${player.name} threads the needle.`,
          `Simple but effective — ${player.name} plays it forward with purpose.`,
        ].filter(Boolean));
        momentumChange=isHome?[1,0]:[0,1];
      } else if(net>dustThreshold){
        outcome='continue';
        commentary=pick([
          `${player.name} keeps possession`,
          `${player.name} holds up the ball`,
          `${player.name} shields it well`,
          `${player.name} keeps it simple`,
          `Controlled possession. ${player.name} in no rush.`,
          `${player.name} recycles — looking for an angle.`,
          `Patient build-up. ${player.name} holds it under pressure.`,
          `${player.name} links the play — nothing on yet, waits.`,
        ]);
        momentumChange=[0,0];
      } else {
        outcome='intercepted';
        commentary=wx===WX.DUST&&Math.random()<0.4
          ?pick([`${player.name}'s pass lost in the dust storm!`,`Visibility near-zero — ${player.name} plays it straight to ${defender.name}!`])
          :pick([
            `${defender.name} reads the play`,
            `${defender.name} sniffs it out!`,
            `Clever positioning from ${defender.name}`,
            `${defender.name} anticipates — intercepts!`,
            `${defender.name} was always in position — ${player.name} never had a chance.`,
            `That pass was there to be stolen — ${defender.name} obliges.`,
            `${defender.name} gets a foot in — ball won!`,
            `Telegraphed — ${defender.name} picks it off with ease.`,
          ]);
        momentumChange=isHome?[0,-1]:[-1,0];
      }
    }
    return{minute:min,type:'play',team:posTeam.shortName,player:player?.name,defender:defender?.name,outcome,commentary,momentumChange:momentumChange||[0,0]};
  };

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
