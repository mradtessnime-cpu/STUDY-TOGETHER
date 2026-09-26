(() => {
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  let roomId=params.get('room')||'';
  let peer=null, conn=null, role='';
  let voiceCall=null, localStream=null, micMuted=false;
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
    if(conn&&conn.open) conn.send({type:'profile',profile:me});
  }
  document.querySelectorAll('#avatarOptions button').forEach(b=>b.onclick=()=>{me={avatar:b.dataset.avatar,name:b.dataset.name};updateMine()});

  function showFriend(profile){
    $('friendAvatar').textContent=profile.avatar;$('friendAvatar').classList.remove('waiting');$('friendAvatarName').textContent=profile.name;
    $('remoteState').textContent='Studying with you ♡';$('friendNote').textContent='Your friend is here ✨';
  }
  function friendLeft(){
    $('friendAvatar').textContent='♡';$('friendAvatar').classList.add('waiting');$('friendAvatarName').textContent='Waiting for your friend…';$('remoteState').textContent='Waiting…';$('friendNote').textContent='When your friend joins and chooses a character, it appears here. When they leave, it disappears. ✨';
  }
  function wire(c){
    conn=c;conn.on('open',()=>{setStatus('Friend connected ♡');$('remoteState').textContent='Connected';conn.send({type:'profile',profile:me});say('You are studying together! Your characters are visible to each other.');});
    conn.on('data',m=>{if(m.type==='profile')showFriend(m.profile);if(m.type==='chat')addMessage(m.text,false);if(m.type==='goal')$('goalDisplay').textContent='🎯 '+m.text});
    conn.on('close',()=>{conn=null;setStatus('Friend left');friendLeft();say('Your friend left the room. Their character disappeared.');});
    conn.on('error',()=>say('Connection problem. Ask your friend to reopen the room link.'));
  }
  async function getMic(){
    if(localStream) return localStream;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      throw new Error('Microphone is not supported here.');
    }
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    return localStream;
  }
  function setVoiceStatus(t){$('voiceStatus').textContent=t}
  function showEndButton(on){$('voiceEnd').classList.toggle('hidden',!on)}
  function stopVoiceTracks(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
  function endVoice(){
    if(voiceCall){try{voiceCall.close()}catch(e){} voiceCall=null}
    const a=$('remoteAudio');if(a){a.srcObject=null;a.pause()}
    stopVoiceTracks();micMuted=false;$('voiceMute').textContent='🔇 Mute mic';showEndButton(false);
    setVoiceStatus(conn&&conn.open?'Connected — voice call ended':'Voice call ended');
  }
  function attachVoiceCall(call){
    voiceCall=call;showEndButton(true);setVoiceStatus('Connecting voice call…');
    call.on('stream',stream=>{const a=$('remoteAudio');a.srcObject=stream;a.play().catch(()=>{});setVoiceStatus('🟢 Voice call connected')});
    call.on('close',()=>{if(voiceCall===call)endVoice()});
    call.on('error',()=>{if(voiceCall===call){setVoiceStatus('Voice call connection failed');showEndButton(false)}});
  }
  async function callFriend(){
    if(!peer||!conn||!conn.open){setVoiceStatus('Join the same room first.');return}
    try{
      const stream=await getMic();
      micMuted=false;$('voiceMute').textContent='🔇 Mute mic';
      const remoteId=conn.peer;
      const call=peer.call(remoteId,stream,{metadata:{type:'study-voice'}});
      attachVoiceCall(call);
    }catch(e){setVoiceStatus('Microphone permission was not granted.')}
  }
  $('voiceCall').onclick=callFriend;
  $('voiceMute').onclick=()=>{
    if(!localStream){setVoiceStatus('Start the voice call first.');return}
    micMuted=!micMuted;localStream.getAudioTracks().forEach(t=>t.enabled=!micMuted);
    $('voiceMute').textContent=micMuted?'🎙️ Unmute mic':'🔇 Mute mic';
    setVoiceStatus(micMuted?'🔴 Microphone muted':'🟢 Voice call connected');
  };
  $('voiceEnd').onclick=endVoice;

  function createPeer(hostId){
    peer=new Peer(hostId);
    peer.on('open',()=>{setStatus('Room ready');say('Room created. Copy the room link and send it to your friend.');});
    peer.on('connection',wire);
    peer.on('call',async call=>{
      try{const stream=await getMic();call.answer(stream);attachVoiceCall(call)}catch(e){setVoiceStatus('Your friend is calling, but microphone permission was not granted.')}});
    peer.on('error',e=>{say('This room is already in use or the connection failed. Create a new room.');setStatus('Connection error')});
  }
  function joinPeer(id){
    peer=new Peer();
    peer.on('open',()=>{wire(peer.connect(roomPeerId(id),{reliable:true}))});
    peer.on('error',()=>say('Could not join the room. Check the room link/code and try again.'));
  }
  $('createRoom').onclick=()=>{role='host';showRoom(randomRoom());createPeer(roomPeerId(roomId));};
  $('joinRoom').onclick=()=>{const id=$('roomCode').value.trim().toUpperCase();if(!id){say('Enter the room code first.');return}role='guest';showRoom(id);joinPeer(id)};
  $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText($('shareLink').value);say('Room link copied ♡')}catch{$('shareLink').select();document.execCommand('copy');say('Room link copied ♡')}};
  if(roomId){roomId=roomId.toUpperCase();showRoom(roomId);say('Room link opened. Choose your character, then wait for your friend.');joinPeer(roomId)}

  function addMessage(text,meMsg){const e=document.createElement('div');e.className='msg'+(meMsg?' me':'');e.textContent=text;$('chat').appendChild(e);$('chat').scrollTop=$('chat').scrollHeight}
  function sendChat(){const text=$('chatInput').value.trim();if(!text)return;addMessage(text,true);if(conn&&conn.open)conn.send({type:'chat',text});$('chatInput').value=''}
  $('sendChat').onclick=sendChat;$('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};
  $('saveGoal').onclick=()=>{const text=$('goalInput').value.trim();if(!text)return;$('goalDisplay').textContent='🎯 '+text;if(conn&&conn.open)conn.send({type:'goal',text})};

  function parse(v){const [h,m]=v.split(':').map(Number);return(h*60+m)*60000}
  function dur(){let d=parse($('endTime').value)-parse($('startTime').value);if(d<=0)d+=86400000;return d}
  function fmt(ms){let s=Math.max(0,Math.floor(ms/1000));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  function renderDur(){const d=dur();const h=Math.floor(d/3600000),m=Math.floor(d%3600000/60000);$('duration').textContent=`Duration: ${h}h ${String(m).padStart(2,'0')}m`;if(!timerRunning)$('timer').textContent=fmt(d)}
  $('startTime').onchange=renderDur;$('endTime').onchange=renderDur;
  $('timerStart').onclick=()=>{if(timerRemainingMs<=0)timerRemainingMs=dur();timerRunning=true;timerEndMs=Date.now()+timerRemainingMs;$('timerStatus').textContent='Focusing ♡';clearInterval(timerInterval);timerInterval=setInterval(tick,250);tick()};
  $('timerPause').onclick=()=>{if(!timerRunning)return;timerRemainingMs=Math.max(0,timerEndMs-Date.now());timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Paused';$('timer').textContent=fmt(timerRemainingMs)};
  $('timerReset').onclick=()=>{timerRunning=false;clearInterval(timerInterval);timerRemainingMs=dur();$('timerStatus').textContent='Ready ♡';$('timer').textContent=fmt(timerRemainingMs)};
  function tick(){timerRemainingMs=Math.max(0,timerEndMs-Date.now());$('timer').textContent=fmt(timerRemainingMs);if(timerRemainingMs<=0){timerRunning=false;clearInterval(timerInterval);$('timerStatus').textContent='Finished ♡'}}
  $('leaveRoom').onclick=()=>{endVoice();if(conn)conn.close();if(peer)peer.destroy();friendLeft();location.href=location.pathname};
  renderDur();updateMine();
})();
