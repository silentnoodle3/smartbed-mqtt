import { Dictionary } from '@utils/Dictionary';
import { logError } from '@utils/logger';
import { readFileSync, writeFileSync } from 'fs';

// The RevCB control box has no way to report what's stored in a memory slot - the
// only way to know is to recall it and watch position feedback. So the add-on
// captures the bed's position itself at the moment a Program Memory button is
// pressed, and persists it here (in the add-on's /data volume, same convention as
// options.ts's own '../data/options.json') so it survives an add-on restart, not
// just an in-memory cache.
const FILE_PATH = '../data/revcb-memory-positions.json';

export type MemoryPosition = { head: number; foot: number };
type StoredData = Dictionary<Dictionary<MemoryPosition>>; // deviceName -> slot -> position

const load = (): StoredData => {
  try {
    return JSON.parse(readFileSync(FILE_PATH).toString());
  } catch {
    return {};
  }
};

export const loadMemoryPositions = (deviceName: string): Dictionary<MemoryPosition> => load()[deviceName] || {};

export const saveMemoryPosition = (deviceName: string, slot: number, head: number, foot: number) => {
  const data = load();
  if (!data[deviceName]) data[deviceName] = {};
  data[deviceName][slot] = { head, foot };
  try {
    writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    logError('[Reverie] Failed to persist memory position', e);
  }
};
