import { AccessoryPlugin, API, Logger, Service } from 'homebridge';

export class SpeedSensorAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private speed = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string, type: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.LightSensor(name);
    this.service.getCharacteristic(C.CurrentAmbientLightLevel).onGet(() => Math.max(this.speed, 0.0001));
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
    this.service.updateCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel, Math.max(mbps, 0.0001));
    this.log.debug(`${this.name}: ${mbps} Mbps`);
  }
}
