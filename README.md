# Study Together — Multi-Person Voice Room

A GitHub Pages-ready study room with animated characters, multi-person rooms, private chat, shared goal, adjustable focus timer, and group voice calling.

## How it works
1. One person creates a room.
2. Copy the room link and send it to as many friends as you want.
3. Everyone opens the same link and chooses a character.
4. All participants appear in the room together.
5. Start group voice to talk with everyone without a camera.

## Important
- Host rooms use PeerJS/WebRTC and require an internet connection.
- GitHub Pages provides HTTPS, which is required for microphone access.
- Each participant must allow microphone permission to use group voice.
- The group voice is peer-to-peer mesh, so every participant connects directly to the others. Very large rooms may use more bandwidth than small rooms.


## Room fix
This version improves room joining, participant presence, reconnection, and roster exchange while keeping the existing design.
