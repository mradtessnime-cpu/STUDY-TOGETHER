(() => {
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  let roomId=params.get('room')||'';
  let hostPeerId=params.get('host')||'';
  let peer=null, role='', myPeerId='';
  const dataConns=new Map();
  const profiles=new Map();
  const voiceCalls=new Map();
  let localStream=null, micMuted=false;
  let chatHistory=[];
  const videoCalls=new Map();
  let cameraStream=null, cameraOn=false;
  let me={avatar:'🐰',name:'Bunny'};
  let timerRunning=false,timerEndMs=0,timerRemainingMs=0,timerInterval=null;
  const sharedGoals=[];

  const setStatus=t=>$('connectionStatus').textContent=t;
  const say=t=>$('roomHint').textContent=t;
  const roomPeerId=id=>'study-together-'+id.toLowerCase();
  const shareUrl=(id,host)=>location.origin+location.pathname+'?room='+encodeURIComponent(id)+(host?'&host='+encodeURIComponent(host):'');
  function randomRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
  function showRoom(id,host=hostPeerId){roomId=id;hostPeerId=host||'';$('roomCode').value=id;$('shareLink').value=shareUrl(id,hostPeerId);$('shareRow').classList.remove('hidden');$('avatarConnection').textContent='Room '+id}

  function updateMine(){
    $('myAvatar').textContent=me.avatar;$('myAvatarName').textContent='You · '+me.name;
    document.querySelectorAll('#avatarOptions button').forEach(b=>b.classList.toggle('selected',b.dataset.avatar===me.avatar));
    broadcast({type:'profile',profile:me,peerId:myPeerId});
  }
  document.querySelectorAll('#avatarOptions button').forEach(b=>b.onclick=()=>{me={avatar:b.dataset.avatar,name:b.dataset.name};updateMine()});

  function memberCard(id,profile,isMe=false){
    const el=document.createElement('div');el.className='member-card';el.dataset.peer=id;
    el.innerHTML=`<div class="member-avatar">${profile.avatar}</div><div class="member-name">${isMe?'You · ':''}${escapeHtml(profile.name)}</div><div class="member-state">${isMe?'You':'Studying ♡'}</div>`;
    return el;
  }
  function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function renderMembers(){
    const grid=$('membersGrid');grid.innerHTML='';
    grid.appendChild(memberCard(myPeerId,me,true));
    profiles.forEach((p,id)=>grid.appendChild(memberCard(id,p,false)));
    const count=profiles.size+1;
    $('remoteState').textContent=count===1?'Waiting…':`${count} people in room`;
    $('friendNote').textContent=count===1?'Share the room link with multiple people. Everyone who joins can choose a character and appear here. ✨':`${count} people are studying together. Anyone who leaves disappears from the room. ✨`;
  }
  function addProfile(id,profile){profiles.set(id,profile);renderMembers();const tile=document.getElementById('camera-tile-'+id);if(tile){const f=tile.querySelector('.camera-fallback');if(f)f.textContent=profile.avatar||'🐰';}}
  function removeMember(id){profiles.delete(id);renderMembers();endVoiceWith(id);const vc=videoCalls.get(id);if(vc){try{vc.close()}catch(e){}videoCalls.delete(id)}removeVideoTile(id)}

  function renderGoals(){
    const box=$('goalDisplay');
    if(!box)return;
    box.innerHTML='';
    if(!sharedGoals.length){box.textContent='No shared goals yet ♡';return}
    sharedGoals.forEach(g=>{
      const e=document.createElement('label');
      e.className='shared-goal-item'+(g.completed?' completed':'');
      e.dataset.goalId=g.id;
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!g.completed;cb.setAttribute('aria-label','Mark goal complete');
      cb.addEventListener('change',()=>{g.completed=cb.checked;renderGoals();broadcast({type:'goal-update',id:g.id,completed:g.completed,from:myPeerId});});
      const t=document.createElement('span');t.textContent='🎯 '+g.text;
      e.append(cb,t);box.appendChild(e);
    });
  }
  function addGoal(text,id,from='friend',broadcastIt=false){
    text=String(text||'').trim();
    if(!text)return;
    id=id||('g-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
    if(sharedGoals.some(g=>g.id===id))return;
    sharedGoals.push({id,text,from,completed:false});
    if(sharedGoals.length>100)sharedGoals.splice(0,sharedGoals.length-100);
    renderGoals();
    if(broadcastIt)broadcast({type:'goal',text,id,from:myPeerId});
  }
  function goalSnapshot(){return sharedGoals.map(g=>({id:g.id,text:g.text,from:g.from,completed:!!g.completed}));
  }
  function mergeGoals(list){(list||[]).forEach(g=>{addGoal(g.text,g.id,g.from||'friend',false);const existing=sharedGoals.find(x=>x.id===g.id);if(existing)existing.completed=!!g.completed;});renderGoals();}
  function updateGoalState(id,completed){const g=sharedGoals.find(x=>x.id===id);if(!g)return;g.completed=!!completed;renderGoals();}

  function allConns(){return [...dataConns.values()].filter(c=>c&&c.open)}
  function broadcast(msg,exceptId=''){allConns().forEach(c=>{if(c.peer!==exceptId)try{c.send(msg)}catch(e){}})}
  function sendRoster(){
    const list=[{id:myPeerId,profile:me}];profiles.forEach((p,id)=>list.push({id,profile:p}));
    broadcast({type:'roster',members:list,goals:goalSnapshot()});
  }
  function connectMeshTo(id){
    if(!peer||!id||id===myPeerId||dataConns.has(id))return;
    const c=peer.connect(id,{reliable:true});wireData(c);
  }
  function handleRoster(list){
    list.forEach(m=>{if(m.id!==myPeerId && m.profile)addProfile(m.id,m.profile)});
    list.forEach(m=>{if(m.id!==myPeerId)connectMeshTo(m.id)});
  }

  function wireData(c){
    if(!c||!c.peer)return;
    dataConns.set(c.peer,c);
    c.on('open',()=>{
      c.send({type:'profile',profile:me,peerId:myPeerId});
      sendRoster();
      // Ask the newly connected peer for the current room list.
      c.send({type:'request-roster'});
      setStatus(`Connected · ${dataConns.size} connection${dataConns.size===1?'':'s'}`);
      say('You are studying together! Everyone in the room can see the characters.');
      connectMeshTo(c.peer);
      if(cameraOn && cameraStream && !videoCalls.has(c.peer)){try{attachVideoCall(peer.call(c.peer,cameraStream,{metadata:{type:'study-camera'}}),c.peer)}catch(e){}}
    });
    c.on('data',m=>{
      if(m.type==='profile'&&m.peerId){addProfile(m.peerId,m.profile);}
      if(m.type==='roster'){handleRoster(m.members||[]);mergeGoals(m.goals||[]);}
      if(m.type==='request-roster'){c.send({type:'roster',members:[{id:myPeerId,profile:me},...Array.from(profiles.entries()).map(([id,profile])=>({id,profile}))]});c.send({type:'chat-history',messages:chatHistory});}
      if(m.type==='chat'){addMessage(m.text,false,m.from||'friend',m.id);}
      if(m.type==='chat-history'){(m.messages||[]).forEach(x=>addMessage(x.text,x.from===myPeerId?'me':false,x.from||'friend',x.id));}
      if(m.type==='goal')addGoal(m.text,m.id,m.from||c.peer,false);
      if(m.type==='goal-update')updateGoalState(m.id,m.completed);
    });
    c.on('close',()=>{dataConns.delete(c.peer);removeMember(c.peer);setStatus(dataConns.size?`Connected · ${dataConns.size} connection${dataConns.size===1?'':'s'}`:'Room ready');say('Someone left the room. Their character and voice connection disappeared.');});
    c.on('error',()=>dataConns.delete(c.peer));
  }

  async function getMic(){
    if(localStream && localStream.getAudioTracks().some(t=>t.readyState==='live'))return localStream;
    if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Microphone is not supported here.');
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    return localStream;
  }
  function setCameraStatus(t){const e=$('cameraStatus');if(e)e.textContent=t}
  function removeVideoTile(id){const e=document.getElementById('camera-tile-'+id);if(e)e.remove()}
  function addVideoTile(id,label,stream,isLocal=false){
    const grid=$('cameraGrid'); if(!grid)return;
    let tile=document.getElementById('camera-tile-'+id);
    if(!tile){
      tile=document.createElement('div');tile.className='camera-tile';tile.id='camera-tile-'+id;
      const v=document.createElement('video');v.autoplay=true;v.playsInline=true;v.muted=!!isLocal;
      const fallback=document.createElement('div');fallback.className='camera-fallback';fallback.textContent=(profiles.get(id)||{}).avatar||'🐰';
      const l=document.createElement('div');l.className='camera-label';l.textContent=label;
      tile.appendChild(v);tile.appendChild(fallback);tile.appendChild(l);grid.appendChild(tile);
    }
    const prof=profiles.get(id);
    const fallback=tile.querySelector('.camera-fallback');
    if(fallback)fallback.textContent=prof?prof.avatar:(id===myPeerId?me.avatar:'🐰');
    const l=tile.querySelector('.camera-label'); if(l)l.textContent=label;
    const v=tile.querySelector('video');
    if(v){
      if(stream){v.srcObject=stream;v.style.display='block';if(fallback)fallback.style.display='none';v.muted=!!isLocal;v.play().catch(()=>{});}
      else {v.srcObject=null;v.style.display='none';if(fallback)fallback.style.display='flex';}
    }
  }
  function attachVideoCall(call,remoteId){
    if(!call||!remoteId)return;
    const old=videoCalls.get(remoteId);if(old){try{old.close()}catch(e){}}
    videoCalls.set(remoteId,call);
    const prof=profiles.get(remoteId);addVideoTile(remoteId,prof?prof.name:'Friend',null,false);
    call.on('stream',stream=>{const prof=profiles.get(remoteId);addVideoTile(remoteId,prof?prof.name:'Friend',stream,false);setCameraStatus('🟢 Camera connected');});
    call.on('close',()=>{videoCalls.delete(remoteId);removeVideoTile(remoteId);if(cameraOn)setCameraStatus(videoCalls.size?'🟢 Camera on':'📹 Camera on · waiting for others');});
    call.on('error',()=>{videoCalls.delete(remoteId);removeVideoTile(remoteId);setCameraStatus('Camera connection failed. You can try again.')});
  }
  function answerCameraCall(call){
    if(!call)return;
    try{
      const answerStream=cameraStream||new MediaStream();
      call.answer(answerStream);
      attachVideoCall(call,call.peer);
    }catch(e){try{call.close()}catch(err){}setCameraStatus('Camera connection failed. Please try again.')}
  }
  async function startCamera(){
    if(cameraOn)return;
    if(!peer||!myPeerId||!dataConns.size){setCameraStatus('Join the same room first.');return}
    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Camera not supported');
      cameraStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      cameraOn=true;
      addVideoTile(myPeerId,'You',cameraStream,true);
      $('cameraStart').classList.add('hidden');$('cameraStop').classList.remove('hidden');
      setCameraStatus('🟢 Camera on · your friend can see you');
      [...dataConns.keys()].filter(id=>id!==myPeerId).forEach(id=>{
        if(!videoCalls.has(id))try{attachVideoCall(peer.call(id,cameraStream,{metadata:{type:'study-camera'}}),id)}catch(e){}
      });
    }catch(e){cameraStream=null;cameraOn=false;setCameraStatus('Camera permission was not granted. Please allow camera access and try again.')}
  }
  function stopCamera(){
    cameraOn=false;
    videoCalls.forEach(c=>{try{c.close()}catch(e){}});videoCalls.clear();
    if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
    const mine=document.getElementById('camera-tile-'+myPeerId); if(mine)mine.remove();
    document.querySelectorAll('#cameraGrid .camera-tile').forEach(e=>{const id=e.id.replace('camera-tile-','');if(id===myPeerId)e.remove();});
    $('cameraStart').classList.remove('hidden');$('cameraStop').classList.add('hidden');
    setCameraStatus('Camera off · your character stays visible ♡');
  }
  $('cameraStart').onclick=startCamera;
  $('cameraStop').onclick=stopCamera;
  function setVoiceStatus(t){$('voiceStatus').textContent=t}
  function showEndButton(on){$('voiceEnd').classList.toggle('hidden',!on)}
  function applyMicState(){if(localStream)localStream.getAudioTracks().forEach(t=>{t.enabled=!micMuted});const b=$('voiceMute');if(b){b.textContent=micMuted?'🎙️ Unmute mic':'🔇 Mute mic';b.setAttribute('aria-pressed',String(micMuted));}}
  function stopVoiceTracks(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
  function endVoiceWith(id){const call=voiceCalls.get(id);if(call){try{call.close()}catch(e){}voiceCalls.delete(id)}}
  function endAllVoice(){voiceCalls.forEach(c=>{try{c.close()}catch(e){}});voiceCalls.clear();document.querySelectorAll('.remote-audio').forEach(a=>{a.srcObject=null;a.remove()});stopVoiceTracks();micMuted=false;applyMicState();showEndButton(false);setVoiceStatus(dataConns.size?'Group voice ended':'Voice call not started')}
  function attachVoiceCall(call,remoteId){
    if(voiceCalls.has(remoteId)){try{voiceCalls.get(remoteId).close()}catch(e){}}
    voiceCalls.set(remoteId,call);showEndButton(true);setVoiceStatus(`🟢 Group voice · ${voiceCalls.size} connected`);
    let a=document.getElementById('audio-'+remoteId);
    if(!a){a=document.createElement('audio');a.id='audio-'+remoteId;a.className='remote-audio';a.autoplay=true;a.playsInline=true;document.body.appendChild(a)}
    call.on('stream',stream=>{a.srcObject=stream;a.play().catch(()=>{});setVoiceStatus(`🟢 Group voice · ${voiceCalls.size} connected`)});
    call.on('close',()=>{voiceCalls.delete(remoteId);if(a){a.srcObject=null;a.remove()}setVoiceStatus(voiceCalls.size?`🟢 Group voice · ${voiceCalls.size} connected`:'Voice call ended');if(!voiceCalls.size)showEndButton(false)});
    call.on('error',()=>{voiceCalls.delete(remoteId);setVoiceStatus('A voice connection failed. The others can stay connected.')});
  }
  async function startGroupVoice(){
    if(!peer||!myPeerId||!dataConns.size){setVoiceStatus('Join the same room first.');return}
    try{
      await getMic();applyMicState();
      const ids=[...profiles.keys()].filter(id=>id!==myPeerId);
      ids.forEach(id=>{if(!voiceCalls.has(id)){try{attachVoiceCall(peer.call(id,localStream,{metadata:{type:'study-voice'}}),id)}catch(e){}}});
      setVoiceStatus(ids.length?`🟢 Group voice · connecting to ${ids.length} people`:'No other members are connected yet.');
      showEndButton(ids.length>0);
    }catch(e){setVoiceStatus('Microphone permission was not granted.')}
  }
  $('voiceCall').onclick=startGroupVoice;
  $('voiceMute').onclick=()=>{if(!localStream||!localStream.getAudioTracks().some(t=>t.readyState==='live')){setVoiceStatus('Start the group voice call first, then mute or unmute.');return}micMuted=!micMuted;applyMicState();setVoiceStatus(micMuted?'🔴 Microphone muted — others cannot hear you':`🟢 Microphone on · ${voiceCalls.size} connected`)};
  $('voiceEnd').onclick=endAllVoice;

  function setupPeerEvents(){
    peer.on('connection',wireData);
    peer.on('call',async call=>{if(call.metadata&&call.metadata.type==='study-camera'){answerCameraCall(call);return}try{const stream=await getMic();call.answer(stream);attachVoiceCall(call,call.peer)}catch(e){setVoiceStatus('Someone is calling, but microphone permission was not granted.')}});
    peer.on('disconnected',()=>{setStatus('Reconnecting…');try{peer.reconnect()}catch(e){}});
    peer.on('error',e=>{console.error('PeerJS error',e);say('Connection error. Please use the newest room link and try again.');setStatus('Connection error')});
  }
  function createPeer(){
    peer=new Peer(undefined,{debug:1});
    setupPeerEvents();
    peer.on('open',id=>{myPeerId=id;hostPeerId=id;showRoom(roomId,id);setStatus('Room ready · link ready');renderMembers();say('Room created. Copy THIS link and send it to your friend.');});
  }
  function joinPeer(targetPeerId){
    peer=new Peer(undefined,{debug:1});
    setupPeerEvents();
    peer.on('open',id2=>{myPeerId=id2;renderMembers();const target=targetPeerId||roomPeerId(roomId);say('Connecting to the room…');wireData(peer.connect(target,{reliable:true,serialization:'json'}));});
  }
  $('createRoom').onclick=()=>{role='host';showRoom(randomRoom(),'');setStatus('Creating room…');createPeer();};
  $('joinRoom').onclick=()=>{const id=$('roomCode').value.trim().toUpperCase();if(!id){say('Enter the room code first.');return}role='guest';showRoom(id,'');joinPeer(roomPeerId(id))};
  $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText($('shareLink').value);say('Room link copied ♡')}catch{$('shareLink').select();document.execCommand('copy');say('Room link copied ♡')}};
  if(roomId){roomId=roomId.toUpperCase();showRoom(roomId,hostPeerId);say('Room link opened. Connecting…');joinPeer(hostPeerId||roomPeerId(roomId))}

  function addMessage(text,meMsg,from='friend',id){
    if(!text)return;
    if(id && chatHistory.some(x=>x.id===id))return;
    const msgId=id||('m-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
    const item={id:msgId,text:String(text),from:from||'friend'};
    chatHistory.push(item);
    if(chatHistory.length>200)chatHistory=chatHistory.slice(-200);
    const e=document.createElement('div');e.className='msg'+(meMsg?' me':'');e.dataset.msgId=msgId;
    e.textContent=String(text);$('chat').appendChild(e);$('chat').scrollTop=$('chat').scrollHeight;
  }
  function sendChat(){const text=$('chatInput').value.trim();if(!text)return;const id='m-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);addMessage(text,true,myPeerId,id);broadcast({type:'chat',text,id,from:myPeerId});$('chatInput').value=''}
  $('sendChat').onclick=sendChat;$('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};
  $('saveGoal').onclick=()=>{const text=$('goalInput').value.trim();if(!text)return;addGoal(text,null,myPeerId,true);$('goalInput').value=''};

  function parse(v){const [h,m]=v.split(':').map(Number);return(h*60+m)*60000}
  function dur(){let d=parse($('endTime').value)-parse($('startTime').value);if(d<=0)d+=86400000;return d}
  function fmt(ms){let s=Math.max(0,Math.floor(ms/1000));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  function renderDur(){const d=dur();const h=Math.floor(d/3600000),m=Math.floor(d%3600000/60000);$('duration').textContent=`Duration: ${h}h ${String(m).padStart(2,'0')}m`;if(!timerRunning)$('timer').textContent=fmt(d)}
  $('startTime').onchange=renderDur;$('endTime').onchange=renderDur;
  $('timerStart').onclick=()=>{if(timerRemainingMs<=0)timerRemainingMs=dur();timerRunning=true;timerEndMs=Date.now()+timerRemainingMs;$('timerStatus').textContent='Focusing ♡';clearInterval(timerInterval);timerInterval=setInterval(tick,250);tick()};
  $('timerPause').onclick=()=>{if(!timerRunning)return;timerRemainingMs=Math.max(0,timerEndMs-Date.now());timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Paused';$('timer').textContent=fmt(timerRemainingMs)};
  $('timerReset').onclick=()=>{timerRunning=false;clearInterval(timerInterval);timerRemainingMs=dur();$('timerStatus').textContent='Ready ♡';$('timer').textContent=fmt(timerRemainingMs)};
  function tick(){timerRemainingMs=Math.max(0,timerEndMs-Date.now());$('timer').textContent=fmt(timerRemainingMs);if(timerRemainingMs<=0){timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Finished ♡'}}
  $('leaveRoom').onclick=()=>{stopCamera();endAllVoice();dataConns.forEach(c=>{try{c.close()}catch(e){}});if(peer)peer.destroy();profiles.clear();location.href=location.pathname};
  renderDur();renderMembers();renderGoals();updateMine();
})();
