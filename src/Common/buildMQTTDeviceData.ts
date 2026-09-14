import { IDeviceData } from '@ha/IDeviceData';
import { safeId } from '@utils/safeId';

type Device = { friendlyName: string; name: string; address: number | string };

export const buildMQTTDeviceData = ({ friendlyName, name, address }: Device, manufacturer: string): IDeviceData => {
  const deviceTopic = `${safeId(manufacturer)}/${safeId(address.toString())}`;
  return {
    deviceTopic,
    device: {
      ids: [`${address}`],
      name: friendlyName,
      mf: manufacturer,
      mdl: name,
    },
    availabilityTopic: `${deviceTopic}/bleConnection/status`,
  };
};
