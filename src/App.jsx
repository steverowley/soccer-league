import { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import TEAMS from "./teams.js";

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
    aiThoughts:[],socialFeed:[],
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

  useEffect(()=>{if(evtLogRef.current)evtLogRef.current.scrollTop=evtLogRef.current.scrollHeight;},[matchState.events]);
  useEffect(()=>{return()=>{clearInterval(intervalRef.current);clearTimeout(toastRef.current);};},[]);
  useEffect(()=>{if(matchState.isPlaying){clearInterval(intervalRef.current);intervalRef.current=setInterval(simulateMinute,speed);}},[speed,matchState.isPlaying]);

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

  const genPenaltySeq=(min,atk,def,team,defTeam,cardType,aim)=>{
    const seq=[];
    const incidents=[`💥 CONTACT! ${def.name} brings down ${atk.name} in the box!`,`⚠️ HANDBALL! ${def.name}'s arm is up... penalty!`,`🚨 CHALLENGE! ${def.name} lunges at ${atk.name}!`];
    seq.push({minute:min,type:'penalty_incident',commentary:pick(incidents),team:defTeam.shortName,momentumChange:[0,0]});
    if(cardType==='red'){seq.push({minute:min,type:'penalty_red_card',commentary:`🟥 RED CARD! ${def.name} is SENT OFF!`,team:defTeam.shortName,player:def.name,cardType:'red',momentumChange:[0,0]});seq.push({minute:min,type:'penalty_reaction',commentary:`😡 ${defTeam.shortName} furious! Chaos on the pitch!`,team:defTeam.shortName,momentumChange:[0,0]});}
    else if(cardType==='yellow'){seq.push({minute:min,type:'penalty_yellow_card',commentary:`🟨 Yellow card for ${def.name}.`,team:defTeam.shortName,player:def.name,cardType:'yellow',momentumChange:[0,0]});}
    const awarded=[`👉 PENALTY to ${team.shortName}!`,`🎯 NO DOUBT! Penalty awarded!`,`🚨 PENALTY! ${team.shortName} have a golden chance!`];
    seq.push({minute:min,type:'penalty_awarded',commentary:pick(awarded),team:team.shortName,momentumChange:[0,0]});
    let taker=atk;
    if(aim){const agents=aim.activeHomeAgents.concat(aim.activeAwayAgents);const takers=agents.filter(a=>a.canTakePenalty&&a.canTakePenalty()&&(a.player.name!==atk.name));if(takers.length){const best=takers.sort((a,b)=>(b.penaltyAbility||0)-(a.penaltyAbility||0))[0];taker=best.player;seq.push({minute:min,type:'penalty_taker_change',commentary:`👀 ${taker.name} takes the ball. Designated taker.`,team:team.shortName,momentumChange:[0,0]});}}
    const tension=[`⏸️ ${taker.name} places the ball... the crowd holds its breath...`,`😰 Absolute silence... ${taker.name} composes himself...`,`⚡ The tension is UNBEARABLE!`];
    seq.push({minute:min,type:'penalty_tension',commentary:pick(tension),team:team.shortName,momentumChange:[0,0]});
    return{sequence:seq,penaltyTaker:taker,isRed:cardType==='red',isYellow:cardType==='yellow'};
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
    if(event.cardType==='red')posts.push({minute:min,user:'@CosmicFootyNews',text:`🟥 BREAKING: ${event.player} SENT OFF! 10 men!`,likes:rndI(500,2000),retweets:rndI(200,700)});
    return posts;
  };

  const genEvent=(min,homeTeam,awayTeam,momentum,possession,playerStats,score,activePlayers,substitutionsUsed,aiInfluence,aim)=>{
    if(Math.random()>0.35)return null;
    const posTeam=Math.random()*100<possession[0]?homeTeam:awayTeam;
    const defTeam=posTeam===homeTeam?awayTeam:homeTeam;
    const isHome=posTeam===homeTeam;
    const posActive=isHome?activePlayers.home:activePlayers.away;
    const defActive=isHome?activePlayers.away:activePlayers.home;
    const scoreDiff=isHome?(score[0]-score[1]):(score[1]-score[0]);
    let roll=Math.random();
    if(aiInfluence){const td=isHome?aiInfluence.home:aiInfluence.away;if(td.SHOOT>3)roll*=0.7;if(td.ATTACK>5)roll*=0.8;}
    if(scoreDiff<0&&min>=80)roll*=0.5;
    if(aim&&Math.random()<0.12){
      const agents=isHome?aim.activeHomeAgents:aim.activeAwayAgents;
      const agent=pick(agents.filter(a=>a.fatigue<95));
      if(agent){
        if(agent.personality===PERS.AGG&&Math.random()<0.4){const card=aim.shouldGiveCard(60+Math.random()*40);return{minute:min,type:'foul',team:posTeam.shortName,player:agent.player.name,cardType:card,commentary:card?`${agent.player.name} goes in HARD! ${card==='red'?'🟥 RED CARD!':'🟨 Yellow!'}`:`Crunching tackle from ${agent.player.name}!`,isPersonalityEvent:true,momentumChange:card?[3,-5]:[2,-2]};}
        if(agent.personality===PERS.SEL&&agent.player.position==='FW'&&Math.random()<0.3)return{minute:min,type:'shot',team:posTeam.shortName,player:agent.player.name,outcome:'miss',commentary:`${agent.player.name} shoots from distance... WAY OVER! Selfish!`,isPersonalityEvent:true,momentumChange:[-3,2]};
        if(agent.personality===PERS.CRE&&Math.random()<0.25){const win=Math.random()<0.3;return{minute:min,type:win?'goal':'creative_fail',team:posTeam.shortName,player:agent.player.name,outcome:win?'goal':'miss',isGoal:win,commentary:win?`${agent.player.name} tries something OUTRAGEOUS... WHAT A GOAL! ✨🚀`:`${agent.player.name} loses the ball! Too creative!`,isPersonalityEvent:true,momentumChange:win?[15,-10]:[-2,3]};}
        if(agent.personality===PERS.LAZ&&agent.fatigue>50&&Math.random()<0.2){agent.fatigue-=5;return{minute:min,type:'lazy_moment',team:posTeam.shortName,player:agent.player.name,commentary:`${agent.player.name} has stopped running... lazy play!`,isPersonalityEvent:true,momentumChange:[-2,4]};}
        if(agent.personality===PERS.WRK&&agent.fatigue>70&&Math.random()<0.25){agent.fatigue+=5;return{minute:min,type:'workhorse_tackle',team:posTeam.shortName,player:agent.player.name,commentary:`${agent.player.name} is EVERYWHERE despite exhaustion! 💪`,isPersonalityEvent:true,momentumChange:[5,-3]};}
        if(agent.personality===PERS.TEAM&&Math.random()<0.12){const fw=agents.find(a=>a!==agent&&a.player.position==='FW');if(fw){const goal=Math.random()<0.4;return{minute:min,type:'shot',team:posTeam.shortName,player:fw.player.name,assister:agent.player.name,outcome:goal?'goal':'save',isGoal:goal,commentary:goal?`Beautiful from ${agent.player.name}! ${fw.player.name} scores! ⚽`:`Unselfish play from ${agent.player.name}! Saved.`,isPersonalityEvent:true,momentumChange:goal?[12,-8]:[3,-2]};}}
      }
    }
    if(aim&&Math.random()<0.03){const controversies=['missed_penalty','wrong_penalty','missed_foul'];const type=pick(controversies);if(type==='wrong_penalty')return{minute:min,type:'penalty',team:posTeam.shortName,isPenalty:true,commentary:`⚠️ CONTROVERSY! ${aim.referee.name} points to spot... that's NEVER a penalty!`,isControversial:true,momentumChange:[8,-12]};if(type==='missed_penalty')return{minute:min,type:'missed_penalty_call',team:posTeam.shortName,commentary:`⚠️ PENALTY SHOUT! Clear foul... ${aim.referee.name} waves it away!`,isControversial:true,momentumChange:[-5,5]};}
    let player,defender,outcome,commentary,momentumChange=[0,0];
    if(roll<0.05){
      player=getPlayer(defTeam,defActive,'defending');
      const atk=getPlayer(posTeam,posActive,'attacking');
      if(!player||!atk)return null;
      const inBox=Math.random()<0.15;
      const sev=rnd(0,100);
      let card=aim?aim.shouldGiveCard(sev):(sev>85?'red':sev>60?'yellow':null);
      if(card==='yellow'&&playerStats[player.name]?.yellowCard)card='red';
      if(inBox){const pseq=genPenaltySeq(min,atk,player,posTeam,defTeam,card,aim);return{minute:min,type:'penalty_sequence',team:posTeam.shortName,player:atk.name,defender:player.name,outcome:'penalty',commentary:'🚨 PENALTY SEQUENCE...',momentumChange:isHome?[3,0]:[0,3],cardType:card,isPenalty:true,penaltySequence:pseq.sequence,penaltyTaker:pseq.penaltyTaker,isRedCard:pseq.isRed,isYellowCard:pseq.isYellow};}
      commentary=card==='red'?`RED CARD! ${player.name} is sent off!`:card==='yellow'?`${player.name} yellow card for foul on ${atk.name}`:`Foul by ${player.name} on ${atk.name}`;
      momentumChange=isHome?[1,0]:[0,1];if(card==='red')momentumChange=isHome?[2,0]:[0,2];
      return{minute:min,type:'foul',team:defTeam.shortName,player:player.name,outcome:card||'foul',commentary,momentumChange,cardType:card};
    }
    if(roll<0.20){
      player=getPlayer(posTeam,posActive,'attacking','FW')||getPlayer(posTeam,posActive,'attacking');
      const gk=getPlayer(defTeam,defActive,'defending','GK');
      if(!player||!gk)return null;
      const atkRoll=player.attacking*0.7+player.technical*0.3+formBonus(player.name,playerStats)+(aim?aim.getAgentByName(player.name)?.getDecisionBonus()||0:0)+rnd(-15,15);
      const gkRoll=gk.defending*0.7+gk.mental*0.3+formBonus(gk.name,playerStats)+rnd(-15,15);
      const net=atkRoll-gkRoll;
      if(net>10&&Math.random()<0.05){outcome='own_goal';commentary=`😱 OWN GOAL! ${gk.name} fumbles it in!`;return{minute:min,type:'shot',team:defTeam.shortName,player:gk.name,outcome,commentary,momentumChange:isHome?[-5,5]:[5,-5],isGoal:true,animation:{type:'goal',color:defTeam.color}};}
      if(net>15){outcome='goal';const assists=[' Clinical finish!','! Stunning strike! 🚀','! What a player! ⭐'];commentary=`⚽ GOAL! ${player.name}${pick(assists)}`;return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,assister:null,outcome,commentary,momentumChange:isHome?[5,0]:[0,5],isGoal:true,animation:{type:'goal',color:posTeam.color}};}
      if(net>5){outcome='saved';commentary=`GREAT SAVE by ${gk.name}! ${player.name} denied!`;return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome,commentary,momentumChange:isHome?[2,0]:[0,2],animation:{type:'saved',color:defTeam.color}};}
      outcome='miss';commentary=`${player.name} blazes over! Chance gone!`;
      return{minute:min,type:'shot',team:posTeam.shortName,player:player.name,defender:gk.name,outcome,commentary,momentumChange:isHome?[1,0]:[0,1]};
    }
    if(roll<0.40){
      player=getPlayer(posTeam,posActive,'attacking');
      defender=getPlayer(defTeam,defActive,'defending');
      if(!player||!defender)return null;
      const net=player.attacking*0.7+player.athletic*0.3+rnd(-15,15)-(defender.defending*0.7+defender.athletic*0.3+rnd(-15,15));
      if(net>20){outcome='breakthrough';commentary=`${player.name} BREAKS THROUGH! Surging run!`;momentumChange=isHome?[3,0]:[0,3];}
      else if(net>0){outcome='success';commentary=`${player.name} advances past ${defender.name}`;momentumChange=isHome?[1,0]:[0,1];}
      else{outcome='intercepted';commentary=`${defender.name} intercepts ${player.name}`;momentumChange=isHome?[-1,0]:[0,-1];}
      return{minute:min,type:'attack',team:posTeam.shortName,player:player.name,defender:defender.name,outcome,commentary,momentumChange};
    }
    if(roll<0.48){
      player=getPlayer(posTeam,posActive,'technical');
      const gk=getPlayer(defTeam,defActive,'defending','GK');
      const header=getPlayer(posTeam,posActive,'athletic');
      if(!player||!gk||!header)return null;
      const net=header.attacking*0.5+header.athletic*0.5+rnd(-20,20)-(gk.defending*0.7+gk.athletic*0.3+rnd(-20,20));
      if(net>20){outcome='goal';commentary=`GOAL! ${header.name} heads in from the corner! ⚽`;return{minute:min,type:'corner_goal',team:posTeam.shortName,player:header.name,outcome,commentary,momentumChange:isHome?[3,0]:[0,3],isGoal:true,animation:{type:'goal',color:posTeam.color}};}
      if(net>10){outcome='saved';commentary=`Corner from ${player.name}! ${gk.name} punches clear!`;return{minute:min,type:'corner',team:posTeam.shortName,player:player.name,defender:gk.name,outcome,commentary,momentumChange:isHome?[1,0]:[0,1]};}
      outcome='cleared';commentary=`Corner kick cleared by ${defTeam.shortName}`;momentumChange=[0,0];
    } else if(roll<0.52){
      player=Math.random()<0.5?getPlayer(posTeam,posActive,'athletic'):getPlayer(defTeam,defActive,'athletic');
      if(!player)return null;
      const inHome=posActive.includes(player.name);
      const tm=inHome?posTeam:defTeam;
      return{minute:min,type:'injury',team:tm.shortName,player:player.name,outcome:'injured',commentary:`${player.name} is down injured! Medics on!`,momentumChange:[0,0],isInjury:true};
    } else if(roll<0.70){
      defender=getPlayer(defTeam,defActive,'defending','DF');
      player=getPlayer(posTeam,posActive,'attacking');
      if(!defender||!player)return null;
      const net=(defender.defending+defender.athletic)/2+rnd(-20,20)-((player.technical+player.athletic)/2+rnd(-20,20));
      if(net>20){outcome='clean_tackle';commentary=`Perfect tackle from ${defender.name}!`;momentumChange=isHome?[0,-2]:[-2,0];}
      else if(net>0){outcome='success';commentary=`${defender.name} wins the ball`;momentumChange=isHome?[0,-1]:[-1,0];}
      else{outcome='failed';commentary=`${player.name} evades ${defender.name}`;momentumChange=isHome?[1,0]:[0,1];}
      return{minute:min,type:'defense',team:defTeam.shortName,player:defender.name,defender:player.name,outcome,commentary,momentumChange};
    } else {
      player=getPlayer(posTeam,posActive,'technical');
      defender=getPlayer(defTeam,defActive,'defending');
      if(!player||!defender)return null;
      const net=(player.technical+player.mental)/2+rnd(-20,20)-((defender.defending+defender.mental)/2+rnd(-20,20));
      if(net>10){outcome='good_pass';commentary=`${player.name} with a precise pass`;momentumChange=isHome?[1,0]:[0,1];}
      else if(net>-10){outcome='continue';commentary=`${player.name} keeps possession`;momentumChange=[0,0];}
      else{outcome='intercepted';commentary=`${defender.name} reads the play`;momentumChange=isHome?[0,-1]:[-1,0];}
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
        }
        aim.updateManagerEmotion({},prev.score[0],prev.score[1]);
      }
      const event=genEvent(newMin,prev.homeTeam,prev.awayTeam,prev.momentum,prev.possession,prev.playerStats,prev.score,prev.activePlayers,prev.substitutionsUsed,aiInfluence,aim);
      if(!event){
        return{...prev,minute:newMin,stoppageTime:newStop,events:[...prev.events,...interventions].filter(Boolean),aiThoughts:newThoughts.slice(-30),socialFeed:newSocial.slice(-20)};
      }
      const socialPosts=genSocial(event,newMin,prev);
      newSocial=[...newSocial,...socialPosts].slice(-20);
      if(event.isGoal&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('goal_scored');}
      if(event.outcome==='miss'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('shot_missed');}
      if(event.cardType==='yellow'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('yellow_card');}
      if(event.cardType==='red'&&event.player&&aim){const a=aim.getAgentByName(event.player);if(a)a.triggerEmotion('red_card');}
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
      const newActive={...prev.activePlayers};
      let newSubsUsed={...prev.substitutionsUsed};
      let newRedCards={...prev.redCards};
      if(event.cardType==='red'&&event.player){
        const isH=event.team===prev.homeTeam.shortName;
        const key=isH?'home':'away';
        newActive[key]=newActive[key].filter(n=>n!==event.player);
        newRedCards[key]=(newRedCards[key]||0)+1;
        event.substituteInfo={out:event.player,in:null};
      }
      if(event.isInjury&&event.player){
        const isH=event.team===prev.homeTeam.shortName;
        const team=isH?prev.homeTeam:prev.awayTeam;
        const key=isH?'home':'away';
        const sub=makeSub(team,event.player,newActive[key],prev.substitutionsUsed[key],prev.playerStats);
        newActive[key]=sub.newActive;
        if(sub.substitute){event.substituteInfo={out:event.player,in:sub.substitute};newSubsUsed[key]++;if(aim)aim.handleSubstitution(event.player,sub.substitute,isH);}
        else event.substituteInfo={out:event.player,in:null};
      }
      const newStats={...prev.playerStats};
      if(event.isGoal&&event.player)newStats[event.player]={...newStats[event.player],goals:(newStats[event.player]?.goals||0)+1};
      if(event.assister)newStats[event.assister]={...newStats[event.assister],assists:(newStats[event.assister]?.assists||0)+1};
      if(event.outcome==='saved'&&event.defender)newStats[event.defender]={...newStats[event.defender],saves:(newStats[event.defender]?.saves||0)+1};
      if(event.type==='defense'&&event.outcome==='clean_tackle'&&event.player)newStats[event.player]={...newStats[event.player],tackles:(newStats[event.player]?.tackles||0)+1};
      if(event.cardType==='yellow'&&event.player)newStats[event.player]={...newStats[event.player],yellowCard:true};
      if(event.cardType==='red'&&event.player)newStats[event.player]={...newStats[event.player],redCard:true};
      if(event.isInjury&&event.player)newStats[event.player]={...newStats[event.player],injured:true};
      let allEvents=[...prev.events,...interventions];
      if(event.penaltySequence){allEvents=[...allEvents,...event.penaltySequence];}
      else{allEvents=[...allEvents,event];}
      const isKey=event.isGoal&&event.animation?.type==='goal';
      return{...prev,minute:isKey?prev.minute:newMin,stoppageTime:newStop,score:newScore,momentum:newMom,possession:newPoss,events:allEvents.filter(Boolean).slice(-100),currentAnimation:event.animation||null,isPaused:isKey,pauseCommentary:isKey?event.commentary:null,playerStats:newStats,activePlayers:newActive,substitutionsUsed:newSubsUsed,redCards:newRedCards,aiThoughts:newThoughts.slice(-30),socialFeed:newSocial};
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
    setMatchState(p=>({...p,isPlaying:true,isPaused:false}));
    setShowBetting(false);
  };
  const pauseMatch=()=>{clearInterval(intervalRef.current);setMatchState(p=>({...p,isPlaying:false}));};
  const resumeMatch=()=>{if(matchState.minute<90||matchState.inStoppageTime){setMatchState(p=>({...p,isPlaying:true,isPaused:false}));intervalRef.current=setInterval(simulateMinute,speed);}};
  const resetMatch=()=>{clearInterval(intervalRef.current);aiRef.current=null;setAiManager(null);setMatchState(initState());setShowBetting(true);setCurrentBets([]);betsRef.current=[];setBetAmount(100);setBetResult(null);setHtReport(null);setSelectedPlayer(null);};

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

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold" style={{color:C.dust}}>INTERGALACTIC SOCCER LEAGUE</h1>
          <p className="text-xs" style={{opacity:0.6}}>MATCH SIMULATION</p>
          {aiManager&&<div className="text-xs mt-1" style={{color:C.purple}}>🤖 AI AGENTS ACTIVE</div>}
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

        <div className="border mb-3 p-3" style={bdr(C.dust)}>
          <div className="text-xs font-bold mb-2 text-center" style={{color:C.purple}}>⚽ LIVE PITCH</div>
          <div className="relative h-32 border-2" style={{backgroundColor:'#1a4d2e',borderColor:C.dust,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(255,255,255,0.05) 19px,rgba(255,255,255,0.05) 20px)'}}>
            <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{backgroundColor:C.dust,opacity:0.3}}/>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full border-2" style={{borderColor:C.dust,opacity:0.3}}/>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-10 border-2 border-l-0" style={{borderColor:ms.homeTeam.color,backgroundColor:`${ms.homeTeam.color}20`}}/>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-10 border-2 border-r-0" style={{borderColor:ms.awayTeam.color,backgroundColor:`${ms.awayTeam.color}20`}}/>
            <div className="absolute top-1/2 -translate-y-1/2 text-lg transition-all duration-1000" style={{left:`calc(${ms.possession[0]}% - 12px)`}}>⚽</div>
            {aiManager&&[...aiManager.activeHomeAgents,...aiManager.activeAwayAgents].filter(a=>a.emotion!=='neutral').slice(0,4).map((a,i)=>(
              <div key={i} className="absolute text-xs" style={{left:`${a.isHome?10+i*12:55+i*10}%`,top:`${20+i*20}%`,title:a.emotion}}>
                {a.emotion==='ecstatic'?'😄':a.emotion==='frustrated'?'😤':a.emotion==='anxious'?'😰':a.emotion==='proud'?'😊':'😡'}
                <span className="text-xs">{a.player.name.split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs mt-1" style={{opacity:0.6}}>
            <span style={{color:ms.homeTeam.color}}>{ms.homeTeam.shortName} {ms.possession[0]>55?'⚔️':''}</span>
            <span>{ms.possession[0]>55?`${ms.homeTeam.shortName} ATTACKING`:ms.possession[0]<45?`${ms.awayTeam.shortName} ATTACKING`:'MIDFIELD BATTLE'}</span>
            <span style={{color:ms.awayTeam.color}}>{ms.possession[1]>55?'⚔️':''} {ms.awayTeam.shortName}</span>
          </div>
        </div>

        {ms.mvp&&<div className="border p-3 mb-3 flex items-center gap-3" style={bdr(C.purple)}>
          <div className="text-3xl">⭐</div>
          <div className="flex-1">
            <div className="text-xs font-bold" style={{color:C.purple}}>MATCH MVP</div>
            <div className="text-xl font-bold" style={{color:ms.mvp.teamColor}}>{ms.mvp.name}</div>
            <div className="text-xs" style={{opacity:0.6}}>{ms.mvp.position} &bull; {ms.mvp.team}</div>
          </div>
          <div className="flex gap-3 text-xs text-center">
            {ms.mvp.stats.goals>0&&<div><div>⚽</div><div className="font-bold">{ms.mvp.stats.goals}</div></div>}
            {ms.mvp.stats.assists>0&&<div><div>👟</div><div className="font-bold">{ms.mvp.stats.assists}</div></div>}
            {ms.mvp.stats.saves>0&&<div><div>✋</div><div className="font-bold">{ms.mvp.stats.saves}</div></div>}
          </div>
        </div>}

        <div className="border mb-3" style={bdr(C.dust)}>
          <div className="p-2 font-bold text-sm border-b" style={{backgroundColor:C.abyss,borderColor:C.dust,color:C.purple}}>📋 MATCH EVENTS</div>
          <div ref={evtLogRef} className="p-2 h-48 overflow-y-auto space-y-1 text-xs" style={{scrollbarWidth:'thin',scrollbarColor:`${C.purple} ${C.abyss}`}}>
            {ms.events.length===0?<div className="text-center py-16" style={{opacity:0.5}}>Press PLAY to start</div>:
            (()=>{
              const filtered=ms.events.filter(e=>e&&e.commentary&&e.type!=='ai_thought');
              const grouped=[];let curPen=null;
              filtered.forEach(e=>{
                const isPen=e.type&&e.type.startsWith('penalty_');
                if(isPen){if(!curPen)curPen={minute:e.minute,thread:[],isPenaltyThread:true};curPen.thread.push(e);}
                else{if(curPen){grouped.push(curPen);curPen=null;}grouped.push(e);}
              });
              if(curPen)grouped.push(curPen);
              return grouped.map((item,i)=>{
                if(item.isPenaltyThread)return(
                  <div key={i} className="border-l-4 pl-2 py-1" style={{borderColor:C.red,backgroundColor:`${C.red}08`}}>
                    <div className="font-bold mb-1" style={{color:C.red}}>{item.minute}' 🚨 PENALTY SEQUENCE</div>
                    {item.thread.map((e,j)=>{
                      const icons={penalty_incident:'💥',penalty_injury_concern:'😰',penalty_red_card:'🟥',penalty_yellow_card:'🟨',penalty_reaction:'😡',penalty_awarded:'👉',penalty_taker_change:'👀',penalty_tension:'⏸️'};
                      const icon=e.type==='penalty_shot'?(e.isGoal?'⚽':e.outcome==='saved'?'✋':'😱'):(icons[e.type]||'▸');
                      return<div key={j} className="flex gap-2 mb-1"><span>{icon}</span><span className={e.type==='penalty_shot'?'font-bold':''}>{e.commentary}</span></div>;
                    })}
                  </div>
                );
                return(
                  <div key={i} className="p-1.5 border flex gap-2" style={{borderColor:item.isGoal?C.purple:item.cardType==='red'?C.red:C.dust,backgroundColor:item.isGoal?`${C.purple}20`:item.cardType==='red'?`${C.red}10`:C.abyss}}>
                    <div className="font-bold min-w-8" style={{color:C.purple}}>{item.minute}'</div>
                    <div>
                      <div>{item.commentary}</div>
                      {item.substituteInfo&&<div className="text-xs mt-0.5" style={{opacity:0.7,color:C.purple}}>{item.substituteInfo.in?`↓${item.substituteInfo.out} ↑${item.substituteInfo.in}`:<span style={{color:C.red}}>No replacement</span>}</div>}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {ms.isPlaying&&aiManager&&(
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="border p-2" style={bdr(C.purple)}>
              <div className="text-xs font-bold mb-2" style={{color:C.purple}}>🧠 AI THOUGHTS</div>
              <div className="space-y-1 h-48 overflow-y-auto" style={{scrollbarWidth:'thin',scrollbarColor:`${C.purple} ${C.abyss}`}}>
                {(ms.aiThoughts||[]).slice(-12).reverse().map((t,i)=><FeedCard key={i} item={t} isThought={true}/>)}
                {!ms.aiThoughts?.length&&<div className="text-xs text-center py-8" style={{opacity:0.5}}>No thoughts yet...</div>}
              </div>
            </div>
            <div className="border p-2" style={bdr(C.purple)}>
              <div className="text-xs font-bold mb-2" style={{color:C.purple}}>📱 GALACTIC SOCIAL</div>
              <div className="space-y-1 h-48 overflow-y-auto" style={{scrollbarWidth:'thin',scrollbarColor:`${C.purple} ${C.abyss}`}}>
                {(ms.socialFeed||[]).slice(-10).reverse().map((p,i)=><FeedCard key={i} item={p} isThought={false}/>)}
                {!ms.socialFeed?.length&&<div className="text-xs text-center py-8" style={{opacity:0.5}}>No posts yet...</div>}
              </div>
            </div>
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
                {[[C.red,htReport.homeManager,htReport.homeQuote],[C.purple,htReport.awayManager,htReport.awayQuote]].map(([col,name,quote])=>(
                  <div key={name} className="p-2 border" style={bdr(col,C.abyss)}>
                    <div className="text-xs font-bold mb-1" style={{color:col}}>🎙️ {name}</div>
                    <div className="text-xs italic" style={{opacity:0.8}}>"{quote}"</div>
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

      <style>{`
        @keyframes goalPulse{0%{opacity:1;transform:scale(0.5);}50%{opacity:1;transform:scale(1.5);}100%{opacity:0;transform:scale(0.8);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
      `}</style>
    </div>
  );
};

export default MatchSimulator;
