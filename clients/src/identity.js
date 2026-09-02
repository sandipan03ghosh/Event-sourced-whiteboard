const STORAGE_KEY = 'whiteboard-identity';

const ADJECTIVES = [
  'Swift', 'Amber', 'Quiet', 'Bold', 'Clever', 'Bright', 'Calm', 'Eager',
  'Fuzzy', 'Gentle', 'Jolly', 'Keen', 'Lucky', 'Mellow', 'Nimble', 'Plucky'
];

const NOUNS = [
  'Otter', 'Fox', 'Falcon', 'Panda', 'Wolf', 'Heron', 'Lynx', 'Sparrow',
  'Badger', 'Raven', 'Marmot', 'Gecko', 'Puffin', 'Weasel', 'Ibex', 'Newt'
];

const PALETTE = [
  '#E53935', '#8E24AA', '#3949AB', '#00897B',
  '#43A047', '#FB8C00', '#6D4C41', '#546E7A'
];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateIdentity() {
  return {
    name: `${randomFrom(ADJECTIVES)} ${randomFrom(NOUNS)}`,
    color: randomFrom(PALETTE),
    // Stable per-tab identity, unlike socket.id which changes on reconnect.
    authorId: crypto.randomUUID()
  };
}

export function getIdentity() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string' && typeof parsed.color === 'string') {
        if (typeof parsed.authorId !== 'string' || parsed.authorId.length === 0) {
          parsed.authorId = crypto.randomUUID();
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch {
      // fall through to regenerate
    }
  }

  const identity = generateIdentity();
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function setName(newName) {
  const identity = getIdentity();
  identity.name = newName;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
