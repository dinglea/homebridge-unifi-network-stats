import { AccessoryPlugin, API, Logger, Service } from 'homebridge';

// HomeKit's CurrentAmbientLightLevel range.
const clamp = (mbps: number): number => Math.min(Math.max(Number.isFinite(mbps) ? mbps : 0, 0.0001), 100000);

export class SpeedSensorAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private speed = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string, type: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.LightSensor(name);
    this.service.getCharacteristic(C.CurrentAmbientLightLevel).onGet(() => clamp(this.speed));
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, `WAN ${type} speed`)
      .setCharacteristic(C.SerialNumber, `unifi-${type}-speed`);
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  updateSpeed(mbps: number): void {
    this.speed = mbps;
    this.service.updateCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel, clamp(mbps));
    this.log.debug(`${this.name}: ${mbps} Mbps`);
  }
}
