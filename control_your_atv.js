/*
*autor: iPhilBln
*github link: https://github.com/iPhilBln/iobroker-pyatv
*
* username: xyz -> default user for pyatv scripts
* pollingPowerState: 0 -> obj.getPowerStateByEvent() is called for each device, get state in realtime but takes a lot of memory (~77MB for each device), but preferred way
*                   >0 -> obj.getPowerStateByPolling() time in seconds to get the device state
* pathToConfig: path where your config is stored in iobroker
* 
* Blockly: delete line 26-43 and connect your alexa.summary datapoint with pyatv.app datapoint
*/

/*----------========== Einstellungen ==========----------*/

const username = 'iobroker';
const pollingPowerState = 0;

let pathToConfig = '0_userdata.0.apple_tv.config';

const debug = false;

function startSubscription() {
    console.log('start subscription...');

    /*----------========== Eigener Teil ==========----------*/

    on({ id: 'alexa2.0.History.summary', change: 'ne' }, function (dp) {
        const val = dp.state.val
        const alexaDevice = getState('alexa2.0.History.name').val.toLowerCase();

        if (dp.state.val.length > 0) {
            if (val.includes('wohnzimmer')) {
                selectDevice('ATV Wohnzimmer', val);
            } else if (val.includes('schlafzimmer')) {
                selectDevice('ATV Schlafzimmer', val);
            } else if (alexaDevice.includes('küche') || alexaDevice.includes('wohnzimmer')) {
                selectDevice('ATV Wohnzimmer', val);
            } else if (alexaDevice.includes('schlafzimmer')) {
                selectDevice('ATV Schlafzimmer', val);
            }
        }
    });

    /*----------========== Ende Eigener Teil ==========----------*/
}

/*----------========== Geräteauswahl ==========----------*/

function selectDevice(deviceName, strIn) {
    for (let i = 0; i < atvDevices.length; i++) {
        if (atvDevices[i].name.includes(deviceName)) {
            atvDevices[i].setChannel(strIn);
            break;
        }
    }
}

/*----------========== Klasse AppleTv ==========----------*/
class AppleTv {

    #timerSetOnlineState;
    #pid;

    constructor(username, id, name, arrApps, pathToState, credentials) {
        this.id = id;
        this.name = name;
        this.command = '';
        this.arrApps = arrApps;
        this.powerState = false;
        this.username = username;
        this.pathToState = pathToState;
        this.credentials = credentials;
        this.pathToPythonModule = { "remote": '', "script": '' };

        this.#timerSetOnlineState = false;
        this.#pid = 0;
    }

    getPowerStateByEvent() {

        const spawn = require("child_process").spawn;
        const pyFile = this.pathToPythonModule.script;
        const arg1 = '--id';
        const arg2 = this.id;
        const arg3 = '--airplay-credentials';
        const arg4 = this.credentials.airplay;
        const arg5 = '--companion-credentials';
        const arg6 = this.credentials.companion;
        const arg7 = 'push_updates';

        const args = [pyFile, arg1, arg2, arg3, arg4, arg5, arg6, arg7];

        return new Promise( done => {
            const pyspawn = spawn('python3', args);

            this.#pid = pyspawn.pid;

            pyspawn.stdout.setEncoding('utf8');
            pyspawn.stdout.on('data', data => {
                try {
                    let state = JSON.parse(data);
                    if (state.hasOwnProperty('power_state')) {
                        switch (state.power_state) {
                            case 'on':
                                this.setPowerState(true);
                                break;
                            case 'off':
                                this.setPowerState(false);
                        }
                    }
                    done(data);
                }
                catch (error) {
                    done(new Error(`${error}`));
                    return;
                }
            });

            pyspawn.stderr.setEncoding('utf8');
            pyspawn.stderr.on('data', data => {
                console.error(`${this.name} -> stderr: ${data}`);
                done(new Error(`${data}`));
            });

            pyspawn.on('close', code => { console.log(`${this.name} -> child process for device exited with code ${code}`); });

        });
    }

    killGetPowerStateByEvent() {
        exec('kill -2 ' + this.#pid);
    }

    getPowerStateByPolling() {

        const pyFile = this.pathToPythonModule.remote;
        const arg1 = '--id';
        const arg2 = this.id;
        const arg3 = '--airplay-credentials';
        const arg4 = this.credentials.airplay;
        const arg5 = '--companion-credentials';
        const arg6 = this.credentials.companion;
        const arg7 = 'power_state';

        const args = pyFile + ' ' + arg1 + ' ' + arg2 + ' ' + arg3 + ' ' + arg4 + ' ' + arg5 + ' ' + arg6 + ' ' + arg7;

        return new Promise( done => {
            exec('python3 ' + args, (error, stdout, stderr) => {
                if (error) {
                    done(new Error(`${error}`));
                    return;
                }
                if (stdout.includes('On')) this.setPowerState(true);
                else if (stdout.includes('Off')) this.setPowerState(false);
                done({ stdout, stderr });
            });
        });
    }

    setPowerState(powerState) {
        const id = this.pathToState + '.' + this.name + '.online'

        if (!this.#timerSetOnlineState && powerState != this.powerState) {
            this.powerState = powerState;
            this.#timerSetOnlineState = true;
            setTimeout(() => { this.#timerSetOnlineState = false; }, 7500);
            setState(id, this.powerState, true, () => {
                if (powerState) console.log('Your device ' + this.name + ' is powered on.');
                else console.log('Your device ' + this.name + ' is powered off.');
            });
        }
    }

    setPathToPythonModule() {

        const findPathCmd = [
            `find /home/${this.username}/.local/lib/ -name atvremote.py`,
            `find /home/${this.username}/.local/lib/ -name atvscript.py`
        ];

        return new Promise( done => {
            exec(findPathCmd[0], (error, stdout, stderr) => {
                if (error) {
                    done(new Error(`${error}`));
                    return;
                } else {
                    let path = stdout.split('\n');
                    if (path.length > 1) {
                        this.pathToPythonModule.remote = path[0];

                        exec(findPathCmd[1], (error, stdout, stderr) => {
                            if (error) {
                                done(new Error(`${error}`));
                                return;
                            } else {
                                path = stdout.split('\n');
                                if (path.length > 1) {
                                    this.pathToPythonModule.script = path[0];
                                    done(JSON.stringify(this.pathToPythonModule));
                                } else {
                                    console.error('Es konnte kein Skript für pyatv.script gefunden werden.');
                                    done(new Error(`${stderr}`));
                                    return;
                                }
                            }
                        });
                    } else {
                        console.error('Es konnte kein Skript für pyatv.remote gefunden werden.');
                        done(new Error(`${stderr}`));
                        return;
                    }
                }
            });
        });
    }

    setChannel(strIn) {

        const pyFile = this.pathToPythonModule.remote;
        const arg1 = '--id';
        const arg2 = this.id;
        const arg3 = '--airplay-credentials';
        const arg4 = this.credentials.airplay;
        const arg5 = '--companion-credentials';
        const arg6 = this.credentials.companion;

        const args = pyFile + ' ' + arg1 + ' ' + arg2 + ' ' + arg3 + ' ' + arg4 + ' ' + arg5 + ' ' + arg6 + ' ';

        const setState = state => {
            switch (state) {
                case 'home':
                    this.command += 'home ';
                    break;
                case 'hauptmenü':
                case 'home hold':
                    this.command += 'home_hold ';
                    break;
                case 'left':
                    this.command += 'left ';
                    break;
                case 'menu':
                    this.command += 'menu ';
                    break;
                case 'nächste':
                case 'next':
                    this.command += 'next ';
                    break;
                case 'aus':
                case 'off':
                    this.command += 'turn_off ';
                    break;
                case 'ein':
                case 'an':
                case 'on':
                    this.command += 'turn_on ';
                    break;
                case 'pausiere':
                case 'pause':
                    this.command += 'pause ';
                    break;
                case 'spiele':
                case 'play':
                    this.command += 'play ';
                    break;
            }
        };

        const dictCmd = [
            'home',
            'hauptmenü',
            'home hold',
            'left',
            'menü',
            'menu',
            'nächste',
            'next',
            'aus',
            'off',
            'ein',
            'an',
            'on',
            'pausiere',
            'pause',
            'spiele',
            'play'
        ];

        for (let j = 0; j < dictCmd.length; j++) {
            if (strIn.includes(dictCmd[j])) {
                for (let i = 0; i < this.arrApps.length; i++) {
                    if (strIn.includes(this.arrApps[i].name)) {
                        this.command = args;
                        setState(dictCmd[j])
                        this.command += 'launch_app=' + this.arrApps[i].link;
                        exec('python3 ' + this.command);
                        break;
                    }
                }
                break;
            }
        }
    }

    setCmd(cmd) {
        const pyFile = this.pathToPythonModule.remote;
        const arg1 = '--id';
        const arg2 = this.id;
        const arg3 = '--airplay-credentials';
        const arg4 = this.credentials.airplay;
        const arg5 = '--companion-credentials';
        const arg6 = this.credentials.companion;
        const arg7 = cmd;

        const args = pyFile + ' ' + arg1 + ' ' + arg2 + ' ' + arg3 + ' ' + arg4 + ' ' + arg5 + ' ' + arg6 + ' ' + arg7;

        exec('python3 ' + args);
    }

    toString() {
        return '{' +
            '"name":"' + this.name +
            '", "id":"' + this.id +
            '", "credentials":"' + JSON.stringify(this.credentials) +
            '", "apps":"' + JSON.stringify(this.arrApps) +
            '", "username":"' + this.username +
            '", "pathToPythonSkript":"' + JSON.stringify(this.pathToPythonModule) +
            '" }';
    }
}

/*----------========== Geräte erfassen ==========----------*/

let atvDevices, pathToState;

if (pathToConfig.charAt(pathToConfig.length - 1) === '.') pathToConfig = pathToConfig.slice(0, -1);

createDevices(JSON.parse(getState(pathToConfig).val), createDataPoint);

async function createDevices(obj, callback) {
    console.log('start create devices...');
    pathToState = pathToConfig.replace('config', 'devices');

    atvDevices = [];
    for (let i = 0; i < obj.devices.length; i++) {
        atvDevices[i] = new AppleTv(username,
            obj.devices[i].id,
            obj.devices[i].name,
            obj.devices[i].apps,
            pathToState,
            obj.devices[i].credentials);

        const result = await atvDevices[i].setPathToPythonModule();
        if (debug) console.log(result);
        if (debug) console.log(atvDevices[i].toString());
    }
    callback(subscriptionConfigFile);
}

async function createDataPoint(callback) {
    console.log('start create DPs...');

    for (let i = 0; i < atvDevices.length; i++) {
        let nameOfDevice = pathToState + '.' + atvDevices[i].name;

        await createStateAsync(nameOfDevice + '.online', false, true, {
            'name': 'online state',
            'role': 'state',
            'read': true,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created online state for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.app', '', true, {
            'name': 'app cmd',
            'role': 'state',
            'read': true,
            'write': true,
            'type': 'string'
        });
        if (debug) console.log('Created app cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.home', true, true, {
            'name': 'home',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created home cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.home hold', true, true, {
            'name': 'home_hold',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created home hold cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.left', true, true, {
            'name': 'left',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created left cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.menu', true, true, {
            'name': 'menu',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created menu cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.next', true, true, {
            'name': 'next',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created next cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.on', true, true, {
            'name': 'turn_on',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created on cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.off', true, true, {
            'name': 'turn_off',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created off cmd for device: ' + atvDevices[i].name);


        await createStateAsync(nameOfDevice + '.cmd.pause', true, true, {
            'name': 'pause',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created pause cmd for device: ' + atvDevices[i].name);

        await createStateAsync(nameOfDevice + '.cmd.play', true, true, {
            'name': 'play',
            'role': 'button',
            'read': false,
            'write': true,
            'type': 'boolean'
        });
        if (debug) console.log('Created play button for device: ' + atvDevices[i].name);
    }
    callback(subscriptionCmd)
}

function subscriptionConfigFile(callback) {
    on({ id: pathToConfig, change: 'ne' }, function (dp) {
        if (!pollingPowerState) atvDevices.forEach(device => { device.killGetPowerStateByEvent() });
        createDevices(JSON.parse(dp.state.val), createDataPoint);
    });
    callback(startPolling);
}

function subscriptionCmd(callback) {
    console.log('start subscription for commands...')

    for (let i = 0; i < atvDevices.length; i++) {

        let nameOfDevice = pathToState + '.' + atvDevices[i].name;

        on({ id: nameOfDevice + '.cmd.app', change: 'ne' }, function (dp) {
            if (dp.state.val.length > 0) {
                atvDevices[i].setChannel(dp.state.val);
                setStateDelayed(nameOfDevice + '.cmd.app', '', true, 500, true);
            }
        });

        on({
            id: [nameOfDevice + '.cmd.home',
            nameOfDevice + '.cmd.home hold',
            nameOfDevice + '.cmd.left',
            nameOfDevice + '.cmd.menu',
            nameOfDevice + '.cmd.next',
            nameOfDevice + '.cmd.off',
            nameOfDevice + '.cmd.on',
            nameOfDevice + '.cmd.pause',
            nameOfDevice + '.cmd.play'], val: true
        }, function (dp) {
            atvDevices[i].setCmd(dp.name);
            if (debug) console.log('detected command: ' + dp.name);
        });
    }
    callback(startSubscription);
}

async function startPolling(callback) {
    console.log('start polling...');
    if (pollingPowerState) {
        //let callCallback = true;
        let polling = true;
        onStop(() => { polling = false; });
        callback();

        do {
            let ts = new Date().getTime();

            for (let i = 0; i < atvDevices.length; i++) {
                if (debug) console.log('fetching state for ' + atvDevices[i].name + ' ...');
                const { stdout, stderr } = await atvDevices[i].getPowerStateByPolling();
                /*if (debug)*/ console.log('result: ' + stdout, stderr);
            }

            //if (callCallback) callback();
            //callCallback = false;

            let timeDifference = new Date().getTime() - ts;
            if (debug) console.log(pollingPowerState * 1000 - timeDifference);
            await wait(pollingPowerState * 1000 - timeDifference);

        } while (polling);
    } else {
        onStop(() => { atvDevices.forEach( device => { device.killGetPowerStateByEvent(); }); });
        for (let i = 0; i < atvDevices.length; i++) {
            const result = await atvDevices[i].getPowerStateByEvent();
            if (debug) console.log(result);
        }
        callback();
    }
}

