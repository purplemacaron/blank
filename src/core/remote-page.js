'use strict';

/**
 * The built-in remote page. Served from memory; it contains no workspace data
 * until a valid pairing token is supplied. Everything is local and dependency
 * free so it works in a phone browser.
 */
function remotePage({ appName = 'Blank', version = '1.0.0' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#ffffff" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'" />
<title>${appName} Remote</title>
<style>
:root{--bg:#fff;--ink:#14171c;--muted:#6b7280;--faint:#9aa1ab;--line:#e7e9ee;--soft:#f5f7fa;--accent:#2f6bff;--accent-soft:#eef3ff;--green:#1b875f;--red:#c73d3d;--amber:#b0730f}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overscroll-behavior:none}
button,input,textarea,select{font:inherit;color:inherit}
button{cursor:pointer}
.shell{height:100dvh;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);backdrop-filter:blur(12px);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:8px;font-weight:650;letter-spacing:-.02em;font-size:16px}
.mark{width:23px;height:23px;border-radius:7px;background:var(--accent);position:relative;flex:none}
.mark:after{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff}
.top-spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:999px;padding:4px 9px;font-size:11px;color:var(--muted);background:#fff;white-space:nowrap}
.dot{width:6px;height:6px;border-radius:50%;background:var(--faint)}
.dot.on{background:var(--green);box-shadow:0 0 0 3px #e7f5ef}
.dot.busy{background:var(--amber);box-shadow:0 0 0 3px #fdf3e2;animation:pulse 1.3s infinite}
@keyframes pulse{50%{opacity:.45}}
.icon-btn{width:34px;height:34px;border:1px solid var(--line);background:#fff;border-radius:9px;display:grid;place-items:center;flex:none}
.icon-btn:active{background:var(--soft)}
.icon-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.sessionbar{display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);align-items:center}
.sessionbar select{flex:1;min-width:0;border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 30px 8px 10px;font-size:13px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%236b7280' stroke-width='1.7'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
.scroll{flex:1;overflow:auto;padding:18px 14px 20px;scroll-behavior:smooth}
.inner{max-width:720px;margin:0 auto}
.msg{display:flex;gap:9px;margin-bottom:18px;align-items:flex-start}
.msg.user{flex-direction:row-reverse}
.avatar{width:25px;height:25px;border-radius:8px;flex:none;display:grid;place-items:center;font-size:10px;font-weight:700;border:1px solid var(--line);background:var(--soft);color:var(--muted)}
.msg.user .avatar{background:var(--accent);border-color:var(--accent);color:#fff}
.bubble{max-width:min(86%,620px);min-width:0}
.msg.user .bubble{background:var(--accent);color:#fff;border-radius:13px 13px 4px 13px;padding:9px 12px}
.msg.assistant .bubble{background:transparent;padding:2px 0}
.text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.msg.user .text{font-size:14px}
.meta{font-size:10px;color:var(--faint);margin:4px 2px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.msg.user .meta{justify-content:flex-end;color:rgba(255,255,255,.7)}
.live{min-height:20px}
.caret{display:inline-block;width:6px;height:14px;background:var(--accent);border-radius:1px;vertical-align:-2px;margin-left:2px;animation:blink 1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
.working{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);margin:2px 0 14px}
.spinner{width:11px;height:11px;border:1.6px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;color:var(--muted);padding:60px 16px;font-size:13px}
.empty h2{font-size:17px;color:var(--ink);margin:12px 0 5px;letter-spacing:-.02em}
.empty p{margin:0 auto;max-width:320px;line-height:1.55}
.approve{border:1px solid #f1dcb7;background:#fffaf0;border-radius:11px;padding:11px 12px;margin:0 0 14px}
.approve-title{font-size:11px;font-weight:650;color:var(--amber);display:flex;gap:5px;align-items:center}
.approve-desc{font-size:12px;color:#6d5629;margin-top:4px;overflow-wrap:anywhere}
.approve-row{display:flex;gap:7px;margin-top:9px}
.btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:550;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.soft{background:var(--soft)}
.btn.danger{background:#fff5f5;border-color:#f0cccc;color:var(--red)}
.btn:disabled{opacity:.5}
.btn.grow{flex:1}
.composer-wrap{border-top:1px solid var(--line);background:rgba(255,255,255,.96);backdrop-filter:blur(12px);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
.composer{max-width:720px;margin:0 auto;border:1px solid var(--line);border-radius:14px;background:#fff;padding:8px 8px 8px 12px;display:flex;gap:8px;align-items:flex-end;box-shadow:0 6px 22px rgba(20,23,28,.05)}
.composer:focus-within{border-color:#bfd1ff;box-shadow:0 0 0 3px var(--accent-soft)}
.composer textarea{flex:1;border:0;outline:0;resize:none;min-height:24px;max-height:150px;padding:5px 0;background:transparent;font-size:14px;line-height:1.5}
.send{width:34px;height:34px;border-radius:10px;border:0;background:var(--accent);color:#fff;display:grid;place-items:center;flex:none}
.send:disabled{background:#c9d4ee}
.send svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.stop{width:34px;height:34px;border-radius:10px;border:1px solid #d8e2ff;background:#f3f6ff;color:var(--accent);display:grid;place-items:center;flex:none}
.stop[hidden]{display:none}
.stop svg{width:13px;height:13px;fill:currentColor;stroke:none}
.composer-foot{max-width:720px;margin:7px auto 0;display:flex;align-items:center;gap:8px;font-size:10px;color:var(--faint)}
.mode{display:flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
.mode button{border:0;background:#fff;padding:3px 7px;font-size:10px;color:var(--muted)}
.mode button.active{background:var(--accent-soft);color:var(--accent)}
.foot-spacer{flex:1}
.token-screen{min-height:100dvh;display:grid;place-items:center;padding:24px;background:linear-gradient(180deg,#fbfcff,#fff)}
.token-card{width:min(420px,100%);border:1px solid var(--line);border-radius:16px;background:#fff;padding:26px;box-shadow:0 18px 50px rgba(20,23,28,.07)}
.token-card .mark{width:34px;height:34px;border-radius:10px;margin-bottom:14px}
.token-card .mark:after{inset:10px}
.token-card h1{font-size:22px;letter-spacing:-.03em;margin:0 0 5px}
.token-card p{font-size:13px;color:var(--muted);margin:0 0 18px;line-height:1.55}
.label{display:block;font-size:11px;font-weight:600;color:var(--muted);margin:0 0 6px}
.token-input{width:100%;border:1px solid var(--line);border-radius:9px;padding:11px 12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;outline:0}
.token-input:focus{border-color:#bfd1ff;box-shadow:0 0 0 3px var(--accent-soft)}
.token-card .btn{width:100%;margin-top:10px;padding:11px}
.error{color:var(--red);font-size:12px;margin-top:9px;min-height:18px}
.trust{display:flex;gap:6px;align-items:flex-start;font-size:11px;color:var(--faint);margin-top:16px;line-height:1.5}
.hide{display:none!important}
@media(min-width:760px){.scroll{padding:26px 24px}.sessionbar{padding:12px 24px}.top{padding:14px 24px}}
</style>
</head>
<body>
<div class="shell" id="shell">
  <header class="top">
    <div class="brand"><span class="mark"></span><span>${appName}</span></div>
    <span class="pill" id="conn"><span class="dot" id="conn-dot"></span><span id="conn-label">Remote</span></span>
    <div class="top-spacer"></div>
    <button class="icon-btn" id="new-top" title="New session" aria-label="New session"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    <button class="icon-btn" id="signout" title="Disconnect" aria-label="Disconnect"><svg viewBox="0 0 24 24"><path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9"/></svg></button>
  </header>
  <div class="sessionbar" id="sessionbar">
    <select id="session-select" aria-label="Session"></select>
    <button class="icon-btn" id="refresh" aria-label="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg></button>
  </div>
  <main class="scroll" id="scroll">
    <div class="inner" id="thread"></div>
  </main>
  <div class="composer-wrap">
    <div class="composer">
      <textarea id="input" rows="1" placeholder="Message Blank…" autocomplete="off"></textarea>
      <button class="stop" id="stop" aria-label="Stop" title="Stop the run" hidden><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg></button>
      <button class="send" id="send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M5 12l14-7-6 14-2-6-6-1z"/><path d="M13 13l6-8"/></svg></button>
    </div>
    <div class="composer-foot">
      <div class="mode" id="mode"><button data-mode="agent" class="active">Agent</button><button data-mode="plan">Plan</button><button data-mode="ask">Ask</button></div>
      <span id="model">—</span>
      <span class="foot-spacer"></span>
      <span id="hint">Paired over your network</span>
    </div>
  </div>
</div>

<div class="token-screen" id="token-screen">
  <div class="token-card">
    <span class="mark"></span>
    <h1>Connect to ${appName}</h1>
    <p>Enter the pairing token shown in Blank → Settings → Remote. The token stays in this browser tab.</p>
    <label class="label" for="token">Pairing token</label>
    <input class="token-input" id="token" type="password" placeholder="Paste the token" autocomplete="off" spellcheck="false" />
    <button class="btn primary" id="pair">Connect</button>
    <div class="error" id="pair-error"></div>
    <div class="trust"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="flex:none;margin-top:2px"><path d="M12 3l7 3v6c0 4.4-2.8 8.2-7 9-4.2-.8-7-4.6-7-9V6l7-3z"/></svg><span>Blank talks directly to your computer. Nothing is sent to a third-party service. Disconnect at any time.</span></div>
  </div>
</div>

<script>
(function(){
  'use strict';
  var TOKEN_KEY='blank.remote.token';
  var token=sessionStorage.getItem(TOKEN_KEY)||'';
  var hash=location.hash||'';
  if(!token && hash.indexOf('t=')>=0){ token=decodeURIComponent(hash.slice(hash.indexOf('t=')+2)); sessionStorage.setItem(TOKEN_KEY,token); history.replaceState(null,'',location.pathname); }
  var state={sessions:[],sessionId:null,session:null,live:null,approvals:[],allowApprovals:false,running:false,mode:'agent',busy:false};
  var $=function(id){return document.getElementById(id)};
  var esc=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})};
  var time=function(iso){ if(!iso)return ''; try{return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}catch(e){return ''} };

  function api(path, options){
    options=options||{};
    var headers=Object.assign({'authorization':'Bearer '+token}, options.headers||{});
    if(options.body) headers['content-type']='application/json';
    return fetch(path,{method:options.method||'GET',headers:headers,body:options.body?JSON.stringify(options.body):undefined,cache:'no-store'})
      .then(function(response){
        if(response.status===401){ signOut(true); throw new Error('Pairing token rejected.'); }
        return response.json().catch(function(){return {}}).then(function(json){
          if(!response.ok) throw new Error(json.error||('Request failed ('+response.status+')'));
          return json;
        });
      });
  }

  function signOut(expired){
    sessionStorage.removeItem(TOKEN_KEY);
    $('token-screen').classList.remove('hide');
    $('shell').classList.add('hide');
    if(expired){ $('pair-error').textContent='The pairing token is no longer valid. Start Remote again in Blank.'; }
  }

  function enter(){
    $('token-screen').classList.add('hide');
    $('shell').classList.remove('hide');
    loadState(true);
  }

  var pollTimer=null;
  function schedule(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(function(){ if(!$('shell').classList.contains('hide')) loadState(false); },1200);
  }

  function loadState(first){
    var url='/api/state';
    if(state.sessionId) url+='?sessionId='+encodeURIComponent(state.sessionId);
    api(url).then(function(data){
      state.sessions=data.sessions||[];
      state.allowApprovals=Boolean(data.allowApprovals);
      state.remote=Boolean(data.running);
      if(state.sessionId && data.session){ state.session=data.session; state.live=data.live||null; state.running=Boolean(data.running); }
      else if(!state.sessionId){ state.live=null; state.running=false; }
      state.approvals=data.approvals||[];
      $('conn-dot').className='dot '+(state.running?'busy':'on');
      $('conn-label').textContent=state.running?'Working':'Connected';
      renderSessions(); renderThread(); schedule();
    }).catch(function(err){
      $('conn-dot').className='dot'; $('conn-label').textContent='Offline';
      if(first) signOut(false);
      schedule();
    });
  }

  function renderSessions(){
    var select=$('session-select');
    var current=state.sessionId||'';
    var options=['<option value="">New session</option>'].concat(state.sessions.map(function(item){
      return '<option value="'+esc(item.id)+'"'+(item.id===current?' selected':'')+'>'+esc(item.title||'Session')+'</option>';
    }));
    select.innerHTML=options.join('');
    if(state.session){ $('model').textContent=state.session.model||''; }
  }

  function renderThread(){
    var thread=$('thread');
    var messages=(state.session&&state.session.messages)||[];
    var html='';
    messages.forEach(function(message){
      if(message.role!=='user'&&message.role!=='assistant') return;
      var content=String(message.content||'').trim();
      if(!content&&!(message.toolCalls||[]).length) return;
      var isUser=message.role==='user';
      html+='<div class="msg '+(isUser?'user':'assistant')+'"><div class="avatar">'+(isUser?'Y':'B')+'</div><div class="bubble"><div class="text">'+esc(content)+'</div><div class="meta">'+(isUser?'You':esc((message.model||'Blank').split('/').pop()))+' · '+esc(time(message.at))+'</div></div></div>';
    });
    if(state.live && state.live.text){ html+='<div class="msg assistant"><div class="avatar">B</div><div class="bubble"><div class="text live">'+esc(state.live.text)+'<span class="caret"></span></div><div class="meta">'+esc(state.live.model||'')+' · live</div></div></div>'; }
    if(state.running){ html+='<div class="working"><span class="spinner"></span>'+esc(state.live&&state.live.tool?state.live.tool:'Working…')+'</div>'; }
    var stopBtn=$('stop'); if(stopBtn){ stopBtn.hidden=!state.running; stopBtn.disabled=false; }
    if(state.approvals.length){
      state.approvals.forEach(function(item){
        html+='<div class="approve"><div class="approve-title">Approval needed · '+esc(item.tool)+'</div><div class="approve-desc">'+esc(item.summary||item.label||'The agent wants to use a tool.')+'</div><div class="approve-row">'+
          (state.allowApprovals
            ? '<button class="btn primary grow" data-allow="'+esc(item.approvalId)+'">Allow once</button><button class="btn grow" data-always="'+esc(item.approvalId)+'">Always</button><button class="btn danger grow" data-deny="'+esc(item.approvalId)+'">Deny</button>'
            : '<div style="font-size:11px;color:#8a733f">Approve on the desktop app. Remote approvals are turned off.</div>')+
          '</div></div>';
      });
    }
    if(!html){
      html='<div class="empty"><h2>Your agent, in your pocket</h2><p>Send a message to start a session. When Blank asks for permission, you can review it here.</p></div>';
    }
    thread.innerHTML=html;
    var scroll=$('scroll');
    scroll.scrollTop=scroll.scrollHeight;
  }

  function send(){
    var input=$('input');
    var text=input.value.trim();
    if(!text||state.busy) return;
    state.busy=true; $('send').disabled=true;
    api('/api/send',{method:'POST',body:{text:text,sessionId:state.sessionId||undefined,mode:state.mode}})
      .then(function(result){
        input.value=''; input.style.height='24px';
        state.busy=false; $('send').disabled=false;
        if(result.sessionId){ state.sessionId=result.sessionId; }
        loadState(false);
      }).catch(function(err){
        state.busy=false; $('send').disabled=false;
        alert(err.message);
      });
  }

  $('pair').addEventListener('click',function(){
    var value=$('token').value.trim();
    if(!value){ $('pair-error').textContent='Paste the token from Blank → Settings → Remote.'; return; }
    token=value;
    $('pair-error').textContent='';
    api('/api/ping').then(function(){ sessionStorage.setItem(TOKEN_KEY,token); enter(); }).catch(function(err){ $('pair-error').textContent=err.message; });
  });
  $('token').addEventListener('keydown',function(event){ if(event.key==='Enter') $('pair').click(); });
  $('signout').addEventListener('click',function(){ signOut(false); });
  $('new-top').addEventListener('click',function(){ state.sessionId=null; state.session=null; state.live=null; state.approvals=[]; state.running=false; $('session-select').value=''; renderThread(); $('input').focus(); });
  $('refresh').addEventListener('click',function(){ loadState(false); });
  $('session-select').addEventListener('change',function(event){ state.sessionId=event.target.value||null; state.session=null; state.live=null; state.approvals=[]; loadState(false); });
  $('mode').addEventListener('click',function(event){
    var button=event.target.closest('[data-mode]'); if(!button) return;
    state.mode=button.dataset.mode;
    Array.prototype.forEach.call($('mode').children,function(item){ item.classList.toggle('active',item===button); });
  });
  $('send').addEventListener('click',send);
  $('stop').addEventListener('click',function(){
    if(!state.sessionId) return;
    var button=$('stop'); button.disabled=true;
    api('/api/stop',{method:'POST',body:{sessionId:state.sessionId}})
      .then(function(){ loadState(false); })
      .catch(function(err){ alert(err.message); loadState(false); });
  });
  $('input').addEventListener('keydown',function(event){ if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); send(); } });
  $('input').addEventListener('input',function(){ this.style.height='24px'; this.style.height=Math.min(150,this.scrollHeight)+'px'; });
  $('thread').addEventListener('click',function(event){
    var button=event.target.closest('[data-allow],[data-always],[data-deny]');
    if(!button) return;
    var decision=button.hasAttribute('data-always')?'always':button.hasAttribute('data-deny')?'deny':'allow';
    var approvalId=button.getAttribute('data-allow')||button.getAttribute('data-always')||button.getAttribute('data-deny');
    Array.prototype.forEach.call(button.parentElement.querySelectorAll('button'),function(item){ item.disabled=true; });
    api('/api/approve',{method:'POST',body:{approvalId:approvalId,decision:decision}}).then(function(){ loadState(false); }).catch(function(err){ alert(err.message); loadState(false); });
  });

  if(token){ enter(); } else { $('token').focus(); }
})();
</script>
</body>
</html>`;
}

module.exports = { remotePage };
