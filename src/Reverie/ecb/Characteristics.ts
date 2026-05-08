// Service UUID advertised by RevCB_E1 (ECB2208E1 control box)
export const SERVICE_UUID = 'db801000-f324-29c3-38d1-85c0c2e86885';

// Characteristic UUIDs
// The 0x102X characteristics are write targets (command positions to the bed)
// The 0x104X characteristics are notify/read mirrors (bed reports actual current position)
// Values are in raw position units 0–100+ where 0 = flat
export const CharacteristicUUIDs = {
  // Motor position write targets
  HeadWrite:  'db801021-f324-29c3-38d1-85c0c2e86885', // handle 16
  FootWrite:  'db801022-f324-29c3-38d1-85c0c2e86885', // handle 18

  // Motor position notify (bed pushes current position as motors move)
  HeadNotify: 'db801041-f324-29c3-38d1-85c0c2e86885', // handle 26
  FootNotify: 'db801042-f324-29c3-38d1-85c0c2e86885', // handle 30

  // Under-bed light: 0 = off, 100 = on (may support intermediate brightness)
  Light:      'db8010a0-f324-29c3-38d1-85c0c2e86885', // handle 50
};

// Known preset positions (derived from BLE scan with bed in ZeroG)
// These closely match Vitaliy's RS-232 findings: head=32, foot=71
export const Presets = {
  Flat:  { head: 0,  foot: 0  },
  ZeroG: { head: 31, foot: 70 },
};

export const LightValues = {
  Off: 0,
  On:  100,
};
