import { useState } from "react";
import { C, bdr, PERS, PERS_ICON } from "../constants.js";
import { COMMENTATOR_PROFILES } from "../agents.js";

export const Stat = ({ label, a, b, homeColor, awayColor }) => (
  <div style={bdr(C.dust)}>
    <div className="text-xs text-center py-1" style={{ opacity: 0.6 }}>{label}</div>
    <div className="flex items-center gap-1 px-2 pb-2">
      <span className="text-sm font-bold" style={{ color: homeColor }}>{a}</span>
      <div className="flex-1 h-1.5" style={{ backgroundColor: C.abyss }}>
        <div className="h-full" style={{ width: `${typeof a === 'number' ? a : 50}%`, backgroundColor: homeColor }} />
      </div>
      <span className="text-sm font-bold" style={{ color: awayColor }}>{b}</span>
    </div>
  </div>
);

export const PlayerRow = ({ player, stats, isActive, teamColor, agents, isHome, teamName, onSelect }) => {
  const s = stats[player.name] || {};
  const agent = agents?.find(a => a.player.name === player.name);
  const emo = agent?.emotion;
  return (
    <div className="flex items-center justify-between p-1.5 border mb-1"
      onClick={() => isActive && onSelect({ player, agent, stats: s, teamColor, teamName })}
      style={{ borderColor: C.dust, backgroundColor: C.abyss, opacity: isActive ? 1 : 0.5, cursor: isActive ? 'pointer' : 'default' }}>
      <div className="flex-1">
        <div className="text-xs font-bold flex items-center gap-1" style={{ color: isActive ? teamColor : undefined }}>
          {s.subbedOn ? '🔺 ' : ''}{player.name}
          {PERS_ICON[agent?.personality] ? <span className="opacity-60">{PERS_ICON[agent.personality]}</span> : null}
        </div>
        <div className="text-xs flex gap-2" style={{ opacity: 0.6 }}>
          <span>{player.position}</span>
          {agent && <span>😊{Math.round(agent.confidence)}% 💨{Math.round(agent.fatigue)}%</span>}
          {emo && emo !== 'neutral' && <span style={{ color: C.purple }}>{emo}</span>}
        </div>
      </div>
      <div className="flex gap-1 text-sm">
        {s.goals > 0 && <span>⚽{s.goals}</span>}
        {s.assists > 0 && <span>👟{s.assists}</span>}
        {s.saves > 0 && <span>✋{s.saves}</span>}
        {s.yellowCard && <span>🟨</span>}
        {s.redCard && <span>🟥</span>}
        {s.injured && <span>🏥</span>}
      </div>
    </div>
  );
};

export const FeedCard = ({ item, isThought }) => (
  <div className="p-2 border-l-2 mb-2" style={{ borderColor: isThought ? C.red : C.purple, backgroundColor: C.abyss }}>
    <div className="flex items-center gap-2 mb-1">
      {isThought ? <span className="text-lg">{item.emoji}</span> : <span className="text-xs font-bold" style={{ color: C.purple }}>{item.user}</span>}
      <span className="text-xs" style={{ opacity: 0.5 }}>{item.minute}'</span>
    </div>
    {isThought && <span className="text-xs font-bold">{item.player}</span>}
    <div className="text-xs italic mt-1" style={{ opacity: 0.85 }}>"{item.text}"</div>
    {!isThought && <div className="text-xs mt-1" style={{ opacity: 0.5 }}>♥️{item.likes} 🔁{item.retweets}</div>}
  </div>
);

export const AgentCard = ({ item }) => {
  const borderColor = item.type === 'commentator' ? item.color
    : item.type === 'player_thought' ? item.color
    : item.type === 'manager' ? item.color
    : item.type === 'referee' ? '#FFD700'
    : C.purple;
  const label = item.type === 'commentator' ? `${item.name} • ${item.role}`
    : item.type === 'player_thought' ? `${item.name} (inner thought)`
    : item.type === 'manager' ? item.name
    : item.type === 'referee' ? `${item.name} • Referee`
    : 'Agent';
  return (
    <div className="p-2 border-l-2 mb-2" style={{ borderColor, backgroundColor: C.abyss }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{item.emoji}</span>
        <span className="text-xs font-bold" style={{ color: borderColor }}>{label}</span>
        <span className="text-xs ml-auto" style={{ opacity: 0.4 }}>{item.minute}'</span>
      </div>
      <div className="text-xs italic" style={{ opacity: 0.9 }}>"{item.text}"</div>
    </div>
  );
};

export const ApiKeyModal = ({ apiKey, setApiKey, setShowApiKeyModal }) => {
  const [draft, setDraft] = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const save = () => {
    localStorage.setItem('isi_api_key', draft);
    setApiKey(draft);
    setShowApiKeyModal(false);
  };
  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: draft, dangerouslyAllowBrowser: true });
      await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
      setTestResult('✅ Connected!');
    } catch (e) {
      const msg = e?.message || String(e);
      console.error('API test error:', e);
      if (msg.includes('401') || msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('api key'))
        setTestResult('❌ Invalid key — check console.anthropic.com');
      else if (msg.includes('403'))
        setTestResult('❌ Permission denied — check key permissions');
      else
        setTestResult('❌ ' + msg);
    }
    setTesting(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}>
      <div className="w-full max-w-md border p-6" style={{ ...bdr(C.purple, C.ash) }}>
        <h2 className="text-xl font-bold mb-1" style={{ color: C.purple }}>⚙️ AGENT CONFIGURATION</h2>
        <p className="text-xs mb-4" style={{ opacity: 0.6 }}>Paste your Anthropic API key to enable LLM-powered agents. Your key is stored in <code>localStorage</code> and never leaves your browser.</p>
        <div className="mb-3">
          <label className="text-xs font-bold mb-1 block" style={{ color: C.purple }}>ANTHROPIC API KEY</label>
          <input type="password" value={draft} onChange={e => setDraft(e.target.value)} placeholder="sk-ant-..."
            className="w-full p-3 border text-sm font-mono" style={{ backgroundColor: C.abyss, borderColor: C.dust, color: C.dust }} />
        </div>
        <div className="flex gap-2 mb-1">
          <button onClick={test} disabled={testing || !draft} className="px-4 py-2 border text-sm" style={bdr(C.dust, C.abyss)}>
            {testing ? 'Testing...' : 'Test Key'}
          </button>
        </div>
        {testResult && (
          <div className="mb-3 p-2 border text-xs font-mono break-all"
            style={{ borderColor: testResult.startsWith('✅') ? '#00cc66' : C.red, color: testResult.startsWith('✅') ? '#00cc66' : C.red, backgroundColor: C.abyss }}>
            {testResult}
          </div>
        )}
        <div className="mb-4 p-3 border text-xs" style={bdr(C.dust, C.abyss)}>
          <div className="font-bold mb-2" style={{ color: C.purple }}>ACTIVE AGENTS</div>
          {COMMENTATOR_PROFILES.map(p => (
            <div key={p.id} className="flex items-center gap-2 mb-1">
              <span>{p.emoji}</span><span style={{ color: p.color }}>{p.name}</span><span style={{ opacity: 0.5 }}>— {p.role}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 mb-1"><span>🧑‍💼</span><span>Managers</span><span style={{ opacity: 0.5 }}>— Touchline reactions</span></div>
          <div className="flex items-center gap-2 mb-1"><span>⚖️</span><span>Referee</span><span style={{ opacity: 0.5 }}>— Decision explanations</span></div>
          <div className="flex items-center gap-2"><span>💭</span><span>Players</span><span style={{ opacity: 0.5 }}>— Inner monologue</span></div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!draft} className="flex-1 py-2 font-bold border"
            style={{ backgroundColor: C.purple, color: C.abyss, borderColor: C.purple }}>SAVE &amp; ENABLE AGENTS</button>
          <button onClick={() => setShowApiKeyModal(false)} className="px-4 py-2 border" style={bdr(C.dust, C.abyss)}>CANCEL</button>
        </div>
        {apiKey && (
          <button onClick={() => { localStorage.removeItem('isi_api_key'); setApiKey(''); setShowApiKeyModal(false); }}
            className="mt-2 w-full py-1 text-xs border" style={{ borderColor: C.red, color: C.red, backgroundColor: C.abyss }}>
            CLEAR KEY &amp; DISABLE AGENTS
          </button>
        )}
      </div>
    </div>
  );
};

export const BetBtn = ({ type, odds, label, sub, color = C.purple, placeBet, betAmount }) => (
  <button onClick={() => placeBet(type, betAmount, odds)} disabled={betAmount <= 0}
    className="p-3 border w-full" style={{ ...bdr(color, C.abyss), opacity: betAmount <= 0 ? 0.5 : 1, cursor: betAmount <= 0 ? 'not-allowed' : 'pointer' }}>
    <div className="text-xs mb-1" style={{ opacity: 0.7 }}>{label}</div>
    {sub && <div className="text-xs mb-1" style={{ opacity: 0.5 }}>{sub}</div>}
    <div className="text-2xl font-bold" style={{ color }}>{odds}x</div>
    <div className="text-xs mt-1" style={{ opacity: 0.6 }}>Win: {Math.floor(betAmount * parseFloat(odds))} coins</div>
  </button>
);

export const PlayerCard = ({ sp, events, onClose }) => {
  if (!sp) return null;
  const { player, agent, stats, teamColor, teamName } = sp;
  const s = stats || {};
  const evts = events.filter(e => e.player === player.name || e.assister === player.name);
  const DESC = {
    [PERS.SEL]: "Glory hunter. Shoots from everywhere, passes to nobody.",
    [PERS.TEAM]: "The glue. Always finds the open man.",
    [PERS.AGG]: "Leaves a mark — on opponents and the ref.",
    [PERS.CAU]: "Reads the game. Never panics, rarely impresses.",
    [PERS.CRE]: "Unpredictable genius or costly showboat.",
    [PERS.LAZ]: "Tremendous talent. Questionable work rate.",
    [PERS.WRK]: "Will run through a wall. Then run through it again.",
    [PERS.BAL]: "Solid. Dependable. Forgettable in the best way.",
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="w-full max-w-sm border" style={bdr(teamColor, C.ash)} onClick={e => e.stopPropagation()}>
        <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: teamColor }}>
          <div>
            <div className="text-xl font-bold" style={{ color: teamColor }}>{player.name}</div>
            <div className="text-xs" style={{ opacity: 0.6 }}>{player.position} &bull; {teamName} {PERS_ICON[agent?.personality] || ''}</div>
          </div>
          <button onClick={onClose} style={{ opacity: 0.5, fontSize: 18 }}>&#x2715;</button>
        </div>
        <div className="p-3">
          {agent && (
            <div className="mb-3 p-2 border-l-4 text-xs italic" style={{ borderColor: teamColor, backgroundColor: teamColor + '22' }}>
              "{DESC[agent.personality] || 'Plays the game.'}"
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
            <div>
              <div className="font-bold mb-2" style={{ opacity: 0.6 }}>ATTRIBUTES</div>
              {[['ATK', player.attacking], ['DEF', player.defending], ['TEC', player.technical], ['ATH', player.athletic], ['MEN', player.mental]].map(([k, v]) => (
                <div key={k} className="flex items-center gap-1 mb-1">
                  <span className="w-7" style={{ opacity: 0.6 }}>{k}</span>
                  <div className="flex-1 h-1.5" style={{ backgroundColor: C.abyss }}>
                    <div className="h-full" style={{ width: v + '%', backgroundColor: v > 80 ? teamColor : v > 65 ? C.purple : C.dust }} />
                  </div>
                  <span className="w-5 text-right">{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-bold mb-2" style={{ opacity: 0.6 }}>THIS MATCH</div>
              <div className="text-xs space-y-1">
                {s.goals > 0 && <div>&#x26BD; {s.goals} goal{s.goals > 1 ? 's' : ''}</div>}
                {s.assists > 0 && <div>&#x1F45F; {s.assists} assist{s.assists > 1 ? 's' : ''}</div>}
                {s.saves > 0 && <div>&#x270B; {s.saves} save{s.saves > 1 ? 's' : ''}</div>}
                {s.tackles > 0 && <div>&#x1F4AA; {s.tackles} tackle{s.tackles > 1 ? 's' : ''}</div>}
                {s.yellowCard && <div>&#x1F7E8; Booked</div>}
                {s.redCard && <div>&#x1F7E5; Sent off</div>}
                {s.injured && <div>&#x1F3E5; Injured</div>}
                {!s.goals && !s.assists && !s.saves && !s.tackles && !s.yellowCard && <div style={{ opacity: 0.4 }}>Quiet so far</div>}
              </div>
              {agent && (
                <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: C.dust }}>
                  <div style={{ opacity: 0.6 }}>Conf {Math.round(agent.confidence)}% &bull; Fatigue {Math.round(agent.fatigue)}%</div>
                  {agent.emotion !== 'neutral' && <div style={{ color: teamColor }}>{agent.emotion}</div>}
                </div>
              )}
            </div>
          </div>
          {evts.length > 0 && (
            <div className="border-t pt-2" style={{ borderColor: C.dust }}>
              {evts.slice(-4).map((e, i) => (
                <div key={i} className="text-xs py-0.5" style={{ opacity: 0.7 }}>
                  <span style={{ color: C.purple }}>{e.minute}'</span> {(e.commentary || '').slice(0, 55)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
