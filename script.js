(() => {
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  let roomId=params.get('room')||'';
  let peer=null, role='', myPeerId='';
  const dataConns=new Map();
  const profiles=new Map();
  const voiceCalls=new Map();
  let localStream=null, micMuted=false;
  let me={avatar:'🐰',name:'Bunny'};
  let timerRunning=false,timerEndMs=0,timerRemainingMs=0,timerInterval=null;

  const setStatus=t=>$('connectionStatus').textContent=t;
  const say=t=>$('roomHint').textContent=t;
  const roomPeerId=id=>'study-together-'+id.toLowerCase();
  const shareUrl=id=>location.origin+location.pathname+'?room='+encodeURIComponent(id);
  function randomRoom(){return Math.random().toString(36).slice(2,8).toUpperCase()}
  function showRoom(id){roomId=id;$('roomCode').value=id;$('shareLink').value=shareUrl(id);$('shareRow').classList.remove('hidden');$('avatarConnection').textContent='Room '+id}

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
  function addProfile(id,profile){profiles.set(id,profile);renderMembers()}
  function removeMember(id){profiles.delete(id);renderMembers();endVoiceWith(id)}

  function allConns(){return [...dataConns.values()].filter(c=>c&&c.open)}
  function broadcast(msg,exceptId=''){allConns().forEach(c=>{if(c.peer!==exceptId)try{c.send(msg)}catch(e){}})}
  function sendRoster(){
    const list=[{id:myPeerId,profile:me}];profiles.forEach((p,id)=>list.push({id,profile:p}));
    broadcast({type:'roster',members:list});
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
      dataConns.set(c.peer,c);
      c.send({type:'profile',profile:me,peerId:myPeerId});
      c.send({type:'roster',members:[{id:myPeerId,profile:me},...Array.from(profiles.entries()).map(([id,profile])=>({id,profile}))]});
      c.send({type:'request-roster'});
      setStatus(`🟢 Connected · ${dataConns.size} connection${dataConns.size===1?'':'s'}`);
      say('🟢 Connected! Everyone in this room can see each other.');
      connectMeshTo(c.peer);
    });
    c.on('data',m=>{
      if(m.type==='profile'&&m.peerId){addProfile(m.peerId,m.profile);broadcast({type:'profile',profile:m.profile,peerId:m.peerId},m.peerId);sendRoster();}
      if(m.type==='roster')handleRoster(m.members||[]);
      if(m.type==='request-roster'){c.send({type:'roster',members:[{id:myPeerId,profile:me},...Array.from(profiles.entries()).map(([id,profile])=>({id,profile}))]});}
      if(m.type==='chat')addMessage(m.text,false);
      if(m.type==='goal')$('goalDisplay').textContent='🎯 '+m.text;
    });
    c.on('close',()=>{dataConns.delete(c.peer);removeMember(c.peer);setStatus(dataConns.size?`Connected · ${dataConns.size} connection${dataConns.size===1?'':'s'}`:'Room ready');say('Someone left the room. Their character and voice connection disappeared.');});
    c.on('error',()=>dataConns.delete(c.peer));
  }

  async function getMic(){
    if(localStream)return localStream;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Microphone is not supported here.');
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    return localStream;
  }
  function setVoiceStatus(t){$('voiceStatus').textContent=t}
  function showEndButton(on){$('voiceEnd').classList.toggle('hidden',!on)}
  function stopVoiceTracks(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
  function endVoiceWith(id){const call=voiceCalls.get(id);if(call){try{call.close()}catch(e){}voiceCalls.delete(id)}}
  function endAllVoice(){voiceCalls.forEach(c=>{try{c.close()}catch(e){}});voiceCalls.clear();document.querySelectorAll('.remote-audio').forEach(a=>{a.srcObject=null;a.remove()});stopVoiceTracks();micMuted=false;$('voiceMute').textContent='🔇 Mute mic';showEndButton(false);setVoiceStatus(dataConns.size?'Group voice ended':'Voice call not started')}
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
      await getMic();micMuted=false;$('voiceMute').textContent='🔇 Mute mic';
      const ids=[...profiles.keys()].filter(id=>id!==myPeerId);
      ids.forEach(id=>{if(!voiceCalls.has(id)){try{attachVoiceCall(peer.call(id,localStream,{metadata:{type:'study-voice'}}),id)}catch(e){}}});
      setVoiceStatus(ids.length?`🟢 Group voice · connecting to ${ids.length} people`:'No other members are connected yet.');
      showEndButton(ids.length>0);
    }catch(e){setVoiceStatus('Microphone permission was not granted.')}
  }
  $('voiceCall').onclick=startGroupVoice;
  $('voiceMute').onclick=()=>{if(!localStream){setVoiceStatus('Start the group voice call first.');return}micMuted=!micMuted;localStream.getAudioTracks().forEach(t=>t.enabled=!micMuted);$('voiceMute').textContent=micMuted?'🎙️ Unmute mic':'🔇 Mute mic';setVoiceStatus(micMuted?'🔴 Microphone muted':`🟢 Group voice · ${voiceCalls.size} connected`)};
  $('voiceEnd').onclick=endAllVoice;

  function createPeer(hostId){
    if(peer){try{peer.destroy()}catch(e){}}
    peer=new Peer(hostId,{debug:1});
    peer.on('open',id=>{
      myPeerId=id;
      setStatus('🟢 Room online');
      renderMembers();
      say('Room is online! Copy the link and send it to your friends.');
    });
    peer.on('connection',wireData);
    peer.on('disconnected',()=>{setStatus('Reconnecting…');try{peer.reconnect()}catch(e){}});
    peer.on('call',async call=>{
      try{const stream=await getMic();call.answer(stream);attachVoiceCall(call,call.peer)}
      catch(e){setVoiceStatus('Someone is calling, but microphone permission was not granted.')}
    });
    peer.on('error',e=>{
      console.error(e);
      setStatus('Connection error');
      say(e&&e.type==='unavailable-id'?'This room is already active. Create a new room.':'Could not connect to the room service. Refresh and try again.');
    });
  }
  function joinPeer(id){
    if(peer){try{peer.destroy()}catch(e){}}
    peer=new Peer(undefined,{debug:1});
    peer.on('open',id2=>{
      myPeerId=id2;
      renderMembers();
      say('Joining room…');
      const c=peer.connect(roomPeerId(id),{reliable:true});
      wireData(c);
      c.on('open',()=>{setStatus('🟢 Joined room');say('🟢 You joined the room! Your friend should see you now.')});
      setTimeout(()=>{
        if(!c.open){setStatus('Could not join room');say('The host may have closed the room. Ask them to keep the room page open and send the link again.')}
      },10000);
    });
    peer.on('connection',wireData);
    peer.on('disconnected',()=>{setStatus('Reconnecting…');try{peer.reconnect()}catch(e){}});
    peer.on('call',async call=>{
      try{const stream=await getMic();call.answer(stream);attachVoiceCall(call,call.peer)}
      catch(e){setVoiceStatus('Someone is calling, but microphone permission was not granted.')}
    });
    peer.on('error',e=>{console.error(e);setStatus('Could not join room');say('Could not join this room. Make sure the host has the room open.')});
  }
  $('createRoom').onclick=()=>{role='host';showRoom(randomRoom());createPeer(roomPeerId(roomId));};
  $('joinRoom').onclick=()=>{const id=$('roomCode').value.trim().toUpperCase();if(!id){say('Enter the room code first.');return}role='guest';showRoom(id);joinPeer(id)};
  $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText($('shareLink').value);say('Room link copied ♡')}catch{$('shareLink').select();document.execCommand('copy');say('Room link copied ♡')}};
  if(roomId){roomId=roomId.toUpperCase();showRoom(roomId);say('Room link opened. Choose your character, then wait for the others.');joinPeer(roomId)}

  function addMessage(text,meMsg){const e=document.createElement('div');e.className='msg'+(meMsg?' me':'');e.textContent=text;$('chat').appendChild(e);$('chat').scrollTop=$('chat').scrollHeight}
  function sendChat(){const text=$('chatInput').value.trim();if(!text)return;addMessage(text,true);broadcast({type:'chat',text});$('chatInput').value=''}
  $('sendChat').onclick=sendChat;$('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};
  $('saveGoal').onclick=()=>{const text=$('goalInput').value.trim();if(!text)return;$('goalDisplay').textContent='🎯 '+text;broadcast({type:'goal',text})};

  function parse(v){const [h,m]=v.split(':').map(Number);return(h*60+m)*60000}
  function dur(){let d=parse($('endTime').value)-parse($('startTime').value);if(d<=0)d+=86400000;return d}
  function fmt(ms){let s=Math.max(0,Math.floor(ms/1000));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  function renderDur(){const d=dur();const h=Math.floor(d/3600000),m=Math.floor(d%3600000/60000);$('duration').textContent=`Duration: ${h}h ${String(m).padStart(2,'0')}m`;if(!timerRunning)$('timer').textContent=fmt(d)}
  $('startTime').onchange=renderDur;$('endTime').onchange=renderDur;
  $('timerStart').onclick=()=>{if(timerRemainingMs<=0)timerRemainingMs=dur();timerRunning=true;timerEndMs=Date.now()+timerRemainingMs;$('timerStatus').textContent='Focusing ♡';clearInterval(timerInterval);timerInterval=setInterval(tick,250);tick()};
  $('timerPause').onclick=()=>{if(!timerRunning)return;timerRemainingMs=Math.max(0,timerEndMs-Date.now());timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Paused';$('timer').textContent=fmt(timerRemainingMs)};
  $('timerReset').onclick=()=>{timerRunning=false;clearInterval(timerInterval);timerRemainingMs=dur();$('timerStatus').textContent='Ready ♡';$('timer').textContent=fmt(timerRemainingMs)};
  function tick(){timerRemainingMs=Math.max(0,timerEndMs-Date.now());$('timer').textContent=fmt(timerRemainingMs);if(timerRemainingMs<=0){timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Finished ♡'}}
  $('leaveRoom').onclick=()=>{endAllVoice();dataConns.forEach(c=>{try{c.close()}catch(e){}});if(peer)peer.destroy();profiles.clear();location.href=location.pathname};
  renderDur();renderMembers();updateMine();
})();
