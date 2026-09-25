import { AccessoryPlugin, API, Logger, Service } from 'homebridge';

// HomeKit's CurrentAmbientLightLevel range.
const clamp = (n: number): number => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0.0001), 100000);

/** Number of clients connected to the network, shown as a Light Sensor (1 client = 1 lux). */
export class ClientCountSensorAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private count = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.LightSensor(name);
    this.service.getCharacteristic(C.CurrentAmbientLightLevel).onGet(() => clamp(this.count));
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, 'Connected clients')
      .setCharacteristic(C.SerialNumber, 'unifi-client-count');
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  /** A null reading (UniFi reported no client counts) keeps the last value. */
  updateCount(count: number | null): void {
    if (count === null) {
      this.log.debug(`${this.name}: no client count reported`);
      return;
    }
    this.count = count;
    this.service.updateCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel, clamp(count));
    this.log.debug(`${this.name}: ${count} clients`);
  }
}
