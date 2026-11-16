// Gra we dwoje: bezpośrednie połączenie przeglądarek (WebRTC przez PeerJS).
// Pokój = kod. Pierwsza osoba z danym kodem zostaje gospodarzem, druga do niej dołącza.
const PREFIX = 'kula-energii-v1-';

export const net = { active: false, connected: false, role: null, code: '', peer: null, conn: null, onMsg: null, onStatus: null };

function status(t) { if (net.onStatus) net.onStatus(t); }

export function joinRoom(code, onStatus, onMsg) {
  leaveRoom();
  code = String(code).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!code) { onStatus('Wpisz kod pokoju (litery/cyfry)'); return; }
  const Peer = window.Peer;
  if (!Peer) { onStatus('Brak biblioteki sieciowej — sprawdź internet'); return; }
  net.active = true; net.code = code; net.onStatus = onStatus; net.onMsg = onMsg;
  const hostId = PREFIX + code + '-host';
  const p = new Peer(hostId, { debug: 0 });
  net.peer = p;
  p.on('open', () => { net.role = 'host'; status(`Pokój „${code}”: czekam na drugą osobę…`); });
  p.on('connection', (c) => { if (net.conn) { c.close(); return; } setup(c); });
  p.on('error', (e) => {
    if (e.type === 'unavailable-id') {
      // pokój ma już gospodarza → dołączamy
      p.destroy();
      const p2 = new Peer({ debug: 0 });
      net.peer = p2;
      p2.on('open', () => { net.role = 'guest'; status(`Łączę z pokojem „${code}”…`); setup(p2.connect(hostId, { reliable: true })); });
      p2.on('error', (e2) => status('Błąd połączenia: ' + (e2.type === 'peer-unavailable' ? 'nie ma takiego pokoju' : e2.type)));
    } else status('Błąd: ' + e.type);
  });
}

function setup(c) {
  net.conn = c;
  c.on('open', () => { net.connected = true; status(`Połączono — pokój „${net.code}” (${net.role === 'host' ? 'gospodarz' : 'gość'})`); if (net.onMsg) net.onMsg({ t: 'hello' }); });
  c.on('data', (d) => { if (net.onMsg) net.onMsg(d); });
  c.on('close', () => { net.connected = false; net.conn = null; status('Druga osoba się rozłączyła'); if (net.onMsg) net.onMsg({ t: 'bye' }); });
  c.on('error', () => status('Błąd połączenia'));
}

export function send(m) {
  if (!net.connected || !net.conn) return;
  try { net.conn.send(m); } catch { /* połączenie zerwane */ }
}

export function leaveRoom() {
  const was = net.active;
  try { if (net.conn) net.conn.close(); } catch { /* */ }
  try { if (net.peer) net.peer.destroy(); } catch { /* */ }
  net.active = false; net.connected = false; net.conn = null; net.peer = null; net.role = null;
  if (was && net.onMsg) net.onMsg({ t: 'bye' });
}
