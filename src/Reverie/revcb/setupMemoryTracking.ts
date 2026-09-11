import { Button } from '@ha/Button';
import { Sensor } from '@ha/Sensor';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { StringsKey } from '@utils/getString';
import { logError } from '@utils/logger';
import { Commands } from './Commands';
import { loadMemoryPositions, saveMemoryPosition } from './MemoryPositionStore';
import { RevCBCommand, RevCBController } from './RevCBController';

interface Cache {
  programMemory1?: Button;
  programMemory2?: Button;
  programMemory3?: Button;
  programMemory4?: Button;
}

// The RevCB control box never reports what's stored in a memory slot - the only way
// anyone (including the official app) can know is to recall it and watch position
// feedback. So instead of trying to read that back from the device, this captures the
// bed's current head/foot position itself at the moment a Program button is pressed,
// publishes it as its own sensor pair, and persists it to disk so it survives an
// add-on restart. Sensor state is published with MQTT retain so it also survives a
// Home Assistant restart without needing a fresh button press.
//
// This owns the Program Memory buttons directly (rather than the generic
// buildCommandButton helper used for the other preset buttons) since pressing one
// needs to do more than just write a command - see setupPresetButtons.ts for the
// plain recall/preset buttons.
export const setupMemoryTracking = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, writeCommand, getLastPosition } = controller;
  const stored = loadMemoryPositions(deviceData.device.name);

  const setupSlot = (
    slot: number,
    cacheKey: keyof Cache,
    programCommand: RevCBCommand,
    programKey: StringsKey,
    headKey: StringsKey,
    footKey: StringsKey
  ) => {
    const headSensor = new Sensor<string>(mqtt, deviceData, buildEntityConfig(headKey), true).setOnline();
    const footSensor = new Sensor<string>(mqtt, deviceData, buildEntityConfig(footKey), true).setOnline();

    const savedPosition = stored[slot];
    if (savedPosition) {
      headSensor.setState(savedPosition.head.toString());
      footSensor.setState(savedPosition.foot.toString());
    }

    if (cache[cacheKey]) return;
    cache[cacheKey] = new Button(mqtt, deviceData, buildEntityConfig(programKey, 'config'), async () => {
      try {
        await writeCommand(programCommand);
      } catch (e) {
        logError('[Reverie] Failed to program memory slot', slot, e);
        return;
      }
      const head = getLastPosition('headPosition');
      const foot = getLastPosition('footPosition');
      if (head === undefined || foot === undefined) return;
      headSensor.setState(head.toString());
      footSensor.setState(foot.toString());
      saveMemoryPosition(deviceData.device.name, slot, head, foot);
    }).setOnline();
  };

  setupSlot(1, 'programMemory1', Commands.ProgramMemory1, 'ProgramMemory1', 'MemoryPosition1Head', 'MemoryPosition1Foot');
  setupSlot(2, 'programMemory2', Commands.ProgramMemory2, 'ProgramMemory2', 'MemoryPosition2Head', 'MemoryPosition2Foot');
  setupSlot(3, 'programMemory3', Commands.ProgramMemory3, 'ProgramMemory3', 'MemoryPosition3Head', 'MemoryPosition3Foot');
  setupSlot(4, 'programMemory4', Commands.ProgramMemory4, 'ProgramMemory4', 'MemoryPosition4Head', 'MemoryPosition4Foot');
};
