/**
 *      iobroker MyAdapter class 
 *      (c) 2019- <frankjoke@hotmail.com>
 *      MIT License
 * 
 *  V 1.1.0 April 2019
 */
"use strict";

//@ts-disable TS80006
//@js-disable TS80006

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter, aoptions, aname, amain;

function startAdapter(options) {
    if (!options)
        options = aoptions;
    options = options || {};
    if (typeof options === 'string')
        options = {
            name: options
        };
    else options.name = aname;
    try {
        adapter = new require('@iobroker/adapter-core').Adapter(options);
        MyAdapter.If('got following adapter: %O', options);
    } catch (e) {
        console.error('cannot find ioBroker...');
    }
    MyAdapter.init2(adapter);
    return adapter;
}

// If started as allInOne/compact mode => return function to create instance

const util = require('util'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    fs = require('fs'),
    exec = require('child_process').exec,
    os = require('os'),
    dns = require('dns'),
    assert = require('assert');

class Sequence {
    constructor(p) {
        this._p = p ? (typeof p === 'function' ? p() : p) : Promise.resolve();
        return this;
    }
    get p() {
        return this._p;
    }
    set p(val) {
        this.ap = val;
        return this;
    }

    set ap(val) {
        let fun = typeof val === 'function' ? val : () => val;
        return this._p = this._p.then(() => fun(), () => fun());
    }

    then(res, rej) {
        return this._p = this._p.then(res, rej);
    }

    catch (rej) {
        return this._p = this._p.then(x => x, rej);
    }

    add(val) {
        return this.p = val;
    }

    addp(val) {
        this.ap = val;
        return this._p;
    }
}

let timer, unload, stopping = false,
    inDebug = false,
    curDebug = 1,
    allStates = null,
    stateChange = null,
    objChange = null,
    onStop = null,
    objects = {},
    states = {},
    systemconf = null,
    stq = new Sequence(),
    sstate = {},
    mstate = {};
let messages = (mes) => Promise.resolve(MyAdapter.W(`Message ${this.O(mes)} received and no handler defined!`));

function slog(adapter, log, text) {
    if (inDebug === undefined)
        return text;
    return adapter && adapter.log && typeof adapter.log[log] === 'function' ?
        // eslint-disable-next-line no-console
        adapter.log[log](text) : console.log(log + ': ' + text);
}

class Setter { // fun = function returng a promise, min = minimal time in ms between next function call
    constructor(fun, min) {
        if (typeof fun !== 'function') throw Error('Invalid Argument - no function for Setter');
        this._efun = fun;
        this._list = [];
        this._current = null;
        this._min = min || 20;
        return this;
    }
    toString() {
        return `Setter(${this._min},${this.length})=${this.length>0 ? this._list[0] : 'empty'}`;
    }
    clearall() {
        this._list = [];
        return this;
    }
    add() {
        function execute(that) {
            if (that.length > 0 && !that._current) {
                that._current = that._list.shift();
                that._efun.apply(null, that._current)
                    .then(() => MyAdapter.wait(that._min), e => e)
                    .then(() => execute(that, that._current = null), () => execute(that, that._current = null));
            }
        }

        const args = Array.prototype.slice.call(arguments);
        this._list.push(args);
        if (this._list.length === 1)
            execute(this);
        return MyAdapter.resolve();
    }
}
class CacheP {
    constructor(fun) { // neue EintrÃ¤ge werden mit dieser Funktion kreiert
        assert(!fun || typeof fun === 'function', 'Cache arg need to be a function returning a promise!');
        this._cache = {};
        this._fun = fun;
    }

    cacheItem(item, fun) {
        let that = this;
        // assert(!fun || A.T(fun) === 'function', 'Cache arg need to be a function returning a promise!');
        //        A.D(`looking for ${item} in ${A.O(this._cache)}`);
        if (this._cache[item] !== undefined)
            return MyAdapter.resolve(this._cache[item]);
        if (!fun)
            fun = this._fun;
        // assert(A.T(fun) === 'function', `checkItem needs a function to fill cache!`);
        return fun(item).then(res => (that._cache[item] = res), err => MyAdapter.D(`checkitem error ${err} finding result for ${item}`, null));
    }

    isCached(x) {
        return this._cache[x];
    }
    clearCache() {
        this._cache = {};
    }
    get cache() {
        return this._cache;
    }
}

function addSState(n, id) {
    if (!mstate[n]) {
        if (sstate[n] && sstate[n] !== id) {
            sstate[id] = id;
            mstate[n] = [id];
            delete sstate[n];
        } else
            sstate[n] = id;
    } else {
        mstate[n].push(id);
        sstate[id] = id;
    }
}


class Hrtime {
    constructor(time) {
        this._stime = time ? time : process.hrtime();
    }

    get diff() {
        return process.hrtime(this._stime);
    }

    get text() {
        const t = this.diff;
        let ns = t[1].toString(10);
        return t[0].toString(10) + '.' + ('0'.repeat(9 - ns.length) + ns).slice(0, 6);

    }

    get sec() {
        return Number(this.text);
    }

    set time(t) {
        this._stime = t;
    }
}

class MyAdapter {
    constructor(adapter, main) {
        if (adapter && main)
            MyAdapter.init(adapter, main);
        return MyAdapter;
    }

    static get config() {
        return systemconf;
    }

    static processMessage(obj) {
        return (obj.command === 'debug' ? this.resolve(`debug set to '${inDebug = isNaN(parseInt(obj.message)) ?  this.parseLogic(obj.message) : parseInt(obj.message)}'`) : messages(obj))
            .then(res => this.D(`Message from '${obj.from}', command '${obj.command}', message '${this.S(obj.message)}' executed with result:"${this.S(res)}"`, res),
                err => this.W(`invalid Message ${this.O(obj)} caused error ${this.O(err)}`, err))
            .then(res => obj.callback ? adapter.sendTo(obj.from, obj.command, res, obj.callback) : undefined)
            .then(() => this.c2p(adapter.getMessage)().then(obj => obj ? this.processMessage(obj) : true));
    }

    static adapterExit(x) {
        MyAdapter.Df('Adapter will exit now with code %s and method %s!', x, adapter && adapter.terminate ? 'adapter.terminate' : 'process.exit');
        adapter && adapter.terminate ? adapter.terminate(x) : process.exit(x);
    }

    static getObjects(name) {
        name = !name ? '' : name;
        let opt = {
            include_docs: true
        };
        if (name) {
            name = name === '*' ? '' : name;
            opt.startkey = (name.startsWith('system.') ? '' : this.ain) + name;
            opt.endkey = (name.startsWith('system.') ? '' : this.ain) + name + '\u9999';
        }
        return this.getObjectList(opt)
            .then(res => res && res.rows ? res.rows : [], () => []);
    }

    static initAdapter() {

        this.Df('Adapter %s starting.', this.ains);
        this.getObjectList = this.c2p(adapter.objects.getObjectList);
        this.getForeignState = adapter.getForeignStateAsync.bind(adapter);
        this.setForeignState = adapter.setForeignStateAsync.bind(adapter);
        this.getState = adapter.getStateAsync.bind(adapter);
        this.setState = adapter.setStateAsync.bind(adapter);
        this.getStates = adapter.getStatesAsync;

        return this.getStates('*').then(res => {
                states = res;
            }, err => this.W(err))
            .then(() => this.getObjects('*').then(res => this.seriesOf(res, i => {
                    var o = i.doc;
                    objects[o._id] = o;
                    if (o.type === 'state' && o.common.name) {
                        if (adapter.config.forceinit && o._id.startsWith(this.ain))
                            return this.removeState(o.common.name);
                        //                    if (!o._id.startsWith('system.adapter.'))
                        return addSState(o.common.name, o._id);
                    }
                    return true;
                }, 0).catch(this.pE)
                .then(() => this.getForeignObject('system.config')).then(res => {
                    //                    systemconf = res[0].doc;
                    if (res)
                        systemconf = res.common;
                    //                    this.If('systemconf: %O', systemconf);
                    if (systemconf && systemconf.language)
                        adapter.config.lang = systemconf.language;
                    if (systemconf && systemconf.latitude) {
                        adapter.config.latitude = parseFloat(systemconf.latitude);
                        adapter.config.longitude = parseFloat(systemconf.longitude);
                    }
                    //                if (adapter.config.forceinit)
                    //                    this.seriesOf(res, (i) => this.removeState(i.doc.common.name), 2)
                    //                this.If('loaded adapter config: %O', adapter.config);
                    return res.length;
                }, MyAdapter.nop)
                .then(() => this.getForeignObject('system.adapter.' + this.ains)).then(res => {
                    //                    adapterconf = res[0].doc;
                    if (res)
                    adapter.config.adapterConf = res.common;
                    //                    this.If('adapterconf = %s: %O', 'system.adapter.' + this.ains, adapterconf);
                    //                    this.If('adapter: %O', adapter);
                    if (adapter.config.adapterConf && adapter.config.adapterConf.loglevel)
                        adapter.config.loglevel = adapter.config.adapterConf.loglevel;
                    if (adapter.config.loglevel === 'debug' || adapter.config.loglevel === 'silly')
                        this.debug = true;
                    //                    this.If('loglevel: %s, debug: %s', adapter.config.loglevel, MyAdapter.debug);
                    //                if (adapter.config.forceinit)
                    //                    this.seriesOf(res, (i) => this.removeState(i.doc.common.name), 2)
                    //                this.If('loaded adapter config: %O', adapter.config);
                    return res.length;
                }, MyAdapter.nop)
            )).catch(err => this.E('err from getObjects: ' + err, 0))

            .then(len => MyAdapter.D(`${adapter.name} received ${len} objects and ${this.ownKeys(states).length} states, with config ${this.ownKeys(adapter.config)}`), (err => this.W(`Error in adapter.ready: ${err}`)))
            .then(() => allStates ? this.c2p(adapter.subscribeForeignStates)('*') : null)
            .then(() => stateChange ? MyAdapter.c2p(adapter.subscribeStates)('*') : null)
            //                .then(() => objChange ? MyAdapter.c2p(adapter.subscribeObjects)('*').then(a => MyAdapter.I('eso '+a),a => MyAdapter.I('eso '+a)) : MyAdapter.resolve())
            .then(() => objChange ? adapter.subscribeObjects('*') : null)
            .then(() => this.I(aname + ' initialization started...'), e => this.stop(this.E(aname + ' Initialization Error:' + this.F(e))));
    }

    static clearStates() {
        states = {};
    }

    static init(amodule, options, ori_main) {
        //        assert(!adapter, `myAdapter:(${ori_adapter.name}) defined already!`);
        if (typeof ori_main !== 'function')
            ori_main = () => {
                this.W(`No 'main() defined for ${adapter.name}!`);
                this.stop(true);
            };
        amain = ori_main;
        if (typeof options === 'string')
            options = {
                name: options
            };
        aoptions = Object.assign({}, options);
        aname = aoptions.name;
        if (amodule && amodule.parent) {
            amodule.exports = startAdapter;
        } else {
            /*
                    options.error = (err) => {
                        this.Ef('Error was catched by Adapter: should check installation or restart: %O', err);
                        this.stop(1);
                        return true;
                    };
            */
            adapter = startAdapter(options);
        }
    }

    static init2() {
        //            if (adapter) this.If('adpter: %O',adapter);
        assert(adapter && adapter.name, 'myAdapter:(adapter) no adapter here!');
        aname = adapter.name;

        inDebug = timer = stopping = false;
        curDebug = 1;
        systemconf =  null;
        objects = {};
        states = {};
        stq = new Sequence();
        sstate = {};
        mstate = {};

        this.writeFile = this.c2p(fs.writeFile);
        this.readFile = this.c2p(fs.readFile);
        this.getForeignObject = adapter.getForeignObjectAsync.bind(adapter);
        this.setForeignObject = adapter.setForeignObjectAsync.bind(adapter);
        this.getForeignObjects = adapter.getForeignObjectsAsync.bind(adapter);
        this.getObject = adapter.getObjectAsync.bind(adapter);
        this.deleteState = (id) => adapter.deleteStateAsync(id).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.delObject = (id, opt) => adapter.delObjectAsync(id, opt).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.delState = (id, opt) => adapter.delStateAsync(id, opt).catch(res => res === 'Not exists' ? this.resolve() : this.reject(res));
        this.removeState = (id, opt) => adapter.delStateAsync(id, opt).then(() => this.delObject((delete this.states[id], id), opt));
        this.setObject = adapter.setObjectAsync.bind(adapter);
        this.createState = adapter.createStateAsync.bind(adapter);
        this.extendObject = adapter.extendObjectAsync.bind(adapter);
        this.extendForeignObject = adapter.extendForeignObjectAsync.bind(adapter);

        //        adapter.removeAllListeners();
        process.on('rejectionHandled', (reason, promise) => this.Wr(true, 'Promise problem rejectionHandled of Promise %s with reason %s', promise, reason));
        process.on('unhandledRejection', (reason, promise) => this.Wr(true, 'Promise problem unhandledRejection of Promise %O with reason %O', promise, reason));


        adapter.on('message', obj => obj && this.processMessage(this.D(`received Message ${this.O(obj)}`, obj)))
            .on('unload', callback => this.stop(false, callback))
            .on('ready', () => this.resolve().then(() => this.initAdapter()).then(() => setImmediate(amain), e => this.Ef('Adapter Error, stop: %O', e)))
            .on('objectChange', (id, obj) => obj && obj._id && objChange && setTimeout((id, obj) => objChange(id, obj), 0, id, obj))
            .on('stateChange', (id, state) => setTimeout((id, state) => {
                (state && stateChange && state.from !== 'system.adapter.' + this.ains ?
                    stateChange(id, state).catch(err => this.W(`Error in StateChange for ${id} = ${this.O(err)}`)) :
                    Promise.resolve())
                .then(() => allStates && allStates(id, state).catch(e => this.W(`Error in AllStates for ${id} = ${this.O(e)}`)))
                    .then(() => states[id] = state);
            }, 0, id, state));

        return adapter;
    }

    static idName(id) {
        if (objects[id] && objects[id].common)
            return objects[id].common.name; // + '(' + id + ')';
        if (sstate[id] && sstate[id] !== id)
            return id; // + '(' + sstate[id] + ')';
        return id; // +'(?)';           
    }

    static J( /** string */ str, /** function */ reviewer) {
        let res;
        if (!str)
            return str;
        if (typeof str !== 'string')
            str = str.toString();
        try {
            res = JSON.parse(str, reviewer);
        } catch (e) {
            res = {
                error: e,
                error_description: `${e} on string ${str}`
            };
        }
        return res;
    }

    static pE(x, y) {
        y = y ? y : MyAdapter.pE;

        function get() {
            var oldLimit = Error.stackTraceLimit;
            Error.stackTraceLimit = Infinity;
            var orig = Error.prepareStackTrace;
            Error.prepareStackTrace = function (_, stack) {
                return stack;
            };
            var err = new Error('Test');
            Error.captureStackTrace(err, y);
            var stack = err.stack;
            Error.prepareStackTrace = orig;
            Error.stackTraceLimit = oldLimit;
            return stack.map(site => site.getFileName() ? (site.getFunctionName() || 'anonymous') + ' in ' + site.getFileName() + ' @' + site.getLineNumber() + ':' + site.getColumnNumber() : '');
        }

        MyAdapter.Wf('Promise failed @ %O error: %o', get().join('; '), x);
        return x;
    }

    static nop(obj) {
        return obj;
    }
    static split(x, s) {
        return this.trim((typeof x === 'string' ? x : `${x}`).split(s));
    }
    static trim(x) {
        return Array.isArray(x) ? x.map(this.trim) : typeof x === 'string' ? x.trim() : `${x}`.trim();
    }
    static number(str) {
        if (!isNaN(str))
            str = str % 1 === 0 ? parseInt(str) : parseFloat(str);
        return str;
    }

    static A(arg) {
        if (!arg)
            this.E(this.f.apply(null, Array.prototype.slice.call(arguments, 1)));
        assert.apply(null, arguments);
    }

    static D(str, val) {
        if (!inDebug || curDebug > Number(inDebug))
            return val !== undefined ? val : str;
        return (inDebug ?
            slog(adapter, 'info', `debug: ${str}`) :
            slog(adapter, 'debug', str), val !== undefined ? val : str);
    }

    static Dr(str) {
        if (!inDebug && curDebug > Number(inDebug))
            return str;
        else {
            const s = this.f.apply(null, Array.prototype.slice.call(arguments, 1));
            if (inDebug)
                slog(adapter, 'info', `debug: ` + s);
            else
                slog(adapter, 'debug', s);

        }
        return str;
    }
    static Df(str) {
        if (!(!inDebug && curDebug > Number(inDebug))) {
            str = this.f.apply(null, arguments);
            return inDebug ? slog(adapter, 'info', 'debug: ' + str) : slog(adapter, 'debug', str);
        }
    }
    static F() {
        return util.format.apply(null, arguments);
    }
    static f() {
        return util.format.apply(null, arguments).replace(/\n\s+/g, ' ');
    }
    static I(l, v) {
        return (slog(adapter, 'info', l), v === undefined ? l : v);
    }

    static Ir(ret) {
        slog(adapter, 'info', this.f.apply(null, Array.prototype.slice.call(arguments, 1)));
        return ret;
    }
    static If() {
        return slog(adapter, 'info', this.f.apply(null, arguments));
    }

    static Wf() {
        return slog(adapter, 'warn', this.f.apply(null, arguments));
    }
    static Wr(ret) {
        slog(adapter, 'warn', this.f.apply(null, Array.prototype.slice.call(arguments, 1)));
        return ret;
    }
    static Er(ret) {
        slog(adapter, 'error', this.f.apply(null, Array.prototype.slice.call(arguments, 1)));
        return ret;
    }

    static W(l, v) {
        return (slog(adapter, 'warn', l), v === undefined ? l : v);
    }
    static E(l, v) {
        return (slog(adapter, 'error', l), v === undefined ? l : v);
    }

    static Ef() {
        return slog(adapter, 'error', this.f.apply(null, arguments));
    }

    static number(v) {
        return isNaN(Number(v)) ? 0 : Number(v);
    }

    static set addq(promise) {
        stq.p = promise;
        return stq;
    }

    static get sstate() {
        return sstate;
    }

    static get debug() {
        return inDebug;
    }
    static set debug(y) {
        inDebug = y;
    }
    static get timer() {
        return timer;
    }
    static set timer(y) {
        timer = y;
    }
    static get messages() {
        return messages;
    }
    static set messages(y) {
        assert(typeof y === 'function', 'Error: messages handler not a function!');
        messages = y;
    }
    static get stateChange() {
        return stateChange;
    }
    static set stateChange(y) {
        stateChange = (assert(typeof y === 'function', 'Error: StateChange handler not a function!'), y);
    }
    static get onStop() {
        return onStop;
    }
    static set onStop(y) {
        onStop = (assert(typeof y === 'function', 'Error: StateChange handler not a function!'), y);
    }
    static get allStates() {
        return allStates;
    }
    static set allStates(y) {
        allStates = (assert(typeof y === 'function', 'Error: StateChange handler not a function!'), y);
    }
    static get objChange() {
        return objChange;
    }
    static set objChange(y) {
        objChange = (assert(typeof y === 'function', 'Error: ObjectChange handler not a function!'), y);
    }
    static get unload() {
        return unload;
    }
    static set unload(y) {
        unload = (assert(typeof y === 'function', 'Error: unload handler not a function!'), y);
    }
    static get name() {
        return aname;
    }
    static get states() {
        return states;
    }
    static get adapter() {
        return adapter;
    }
    static get aObjects() {
        return adapter.objects;
    }
    static get objects() {
        return objects;
    }
    static set objects(y) {
        objects = y;
    }
    static get debugLevel() {
        return curDebug;
    }
    static set debugLevel(y) {
        curDebug = y;
    }
    static get ains() {
        return aname + '.' + adapter.instance;
    }
    static get ain() {
        return this.ains + '.';
    }
    static get C() {
        return adapter.config;
    }

    static fullName(id) {
        return this.ain + id;
    }

    static parseLogic(obj) {
        return this.includes(['0', 'off', 'aus', 'false', 'inactive'], obj.toString().trim().toLowerCase()) ?
            false : this.includes(['1', '-1', 'on', 'ein', 'true', 'active'], obj.toString().trim().toLowerCase());
    }
    static clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
    static wait(time, arg) {
        if (isNaN(Number(time)) || Number(time) < 0)
            time = 0;
        if (typeof arg === 'function') {
            let args = Array.prototype.slice.call(arguments, 2);
            return new Promise(res => setTimeout(r => res(arg.apply(null, args)), time));
        }
        return new Promise(res => setTimeout(res, time, arg));
    }

    static P(pv, res, rej) {
        if (pv instanceof Promise)
            return pv;
        if (pv && typeof pv.then === 'function')
            return new Promise((rs, rj) => pv.then(rs, rj));
        if (pv)
            return this.resolve(res || pv);
        return this.reject(rej || pv);
    }

    static resolve(x) {
        return new Promise((res) => process.nextTick(() => res(x)));
    }

    static reject(x) {
        return new Promise((_, rej) => process.nextTick(() => rej(x)));
    }

    static pTimeout(pr, time, callback) {
        let t = parseInt(time);
        assert(typeof t === 'number' && t > 0, `pTimeout requires a positive number as second argument for the ms`);
        let st = null;
        assert(callback && typeof callback === 'function', `pTimeout requires optionally a function for callback as third argument`);
        return new Promise((resolve, reject) => {
            let rs = res => {
                    if (st) clearTimeout(st);
                    st = null;
                    return resolve(res);
                },
                rj = err => {
                    if (st) clearTimeout(st);
                    st = null;
                    return reject(err);
                };
            st = setTimeout(() => {
                st = null;
                reject(`timer ${t} run out`);
            }, t);
            if (callback) callback(rs, rj);
            this.P(pr).then(rs, rj);
        });
    }

    static Ptime(promise, arg) {
        var start = Date.now();
        if (typeof promise === 'function')
            promise = promise(arg);
        return Promise.resolve(promise).then(() => {
            var end = Date.now();
            return end - start;
        });
    }
    static O(obj, level) {
        return util.inspect(obj, {
            depth: level || 2,
            colors: false
        }).replace(/\n\s*/g, '');
    }

    static removeEmpty(obj) {
        if (this.T(obj) !== 'object')
            return obj;
        let a = this.clone(obj);
        for (let n of Object.getOwnPropertyNames(a))
            if (!a[n] && typeof a[n] !== 'boolean') delete a[n];
        return a;
    }
    static S(obj, level) {
        return typeof obj === 'string' ? obj : this.O(obj, level);
    }
    static N(fun) {
        return setImmediate.apply(null, [fun].concat(Array.prototype.slice.call(arguments, 1)));
    } // move fun to next schedule keeping arguments
    static T(i, j) {
        let t = typeof i;
        if (t === 'object') {
            if (Array.isArray(i)) t = 'array';
            else if (i instanceof RegExp) t = 'regexp';
            else if (i === null) t = 'null';
        } else if (t === 'number' && isNaN(i)) t = 'NaN';
        return j === undefined ? t : this.T(j) === t;
    }
    static locDate(date) {
        return date instanceof Date ?
            new Date(date.getTime() - date.getTimezoneOffset() * 60000) :
            typeof date === 'string' ?
            new Date(Date.parse(date) - (new Date().getTimezoneOffset()) * 60000) :
            !isNaN(+date) ?
            new Date(+date - (new Date().getTimezoneOffset()) * 60000) :
            new Date(Date.now() - (new Date().getTimezoneOffset()) * 60000);
    }
    static dateTime(date) {
        return this.locDate(date).toISOString().slice(0, -5).replace('T', '@');
    }
    static obToArray(obj) {
        return (Object.keys(obj).filter(x => obj.hasOwnProperty(x)).map(i => obj[i]));
    }
    static includes(obj, value) {
        return this.T(obj) === 'object' ? obj[value] !== undefined :
            Array.isArray(obj) ? obj.find(x => x === value) !== undefined : obj === value;
    }

    static ownKeys(obj) {
        return this.T(obj) === 'object' ? Object.getOwnPropertyNames(obj) : [];
        //        return this.T(obj) === 'object' ? Object.keys(obj).filter(k => obj.hasOwnProperty(k)) : [];
    }

    static ownKeysSorted(obj) {
        return this.ownKeys(obj).sort(function (a, b) {
            a = a.toLowerCase();
            b = b.toLowerCase();
            if (a > b) return 1;
            if (a < b) return -1;
            return 0;
        });
    }

    static stop(dostop, callback) { // dostop 
        if (stopping) return;
        stopping = true;
        try {
            if (onStop)
                onStop(dostop);
        } catch (e) {}
        if (timer) {
            if (Array.isArray(timer))
                timer.forEach(t => clearInterval(t));
            else
                clearInterval(timer);
            timer = null;
        }
        this.I(`Adapter disconnected and stopped with dostop(${dostop}) and callback(${!!callback})`);
        Promise.resolve(unload ? unload(dostop) : null)
            .catch(e => this.Wf(e))
            .then(() => callback && callback())
            .catch(e => this.Wf(e))
            .then(() => this.W(`Adapter will exit in latest 1 sec with code ${dostop}!`, setTimeout(this.adapterExit, 900, dostop < 0 ? 0 : dostop)));
    }

    static seriesOf(obj, promfn, delay) { // fun gets(item) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay) || 0;
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item of obj)
            f(item);
        return p.then(() => nv);
    }

    static seriesInOI(obj, promfn, delay) { // fun gets(item) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay) || 0;
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item in obj)
            f(obj[item]);
        return p.then(() => nv);
    }

    static seriesIn(obj, promfn, delay) { // fun gets(item,object) and returns a promise
        assert(typeof promfn === 'function', 'series(obj,promfn,delay) error: promfn is not a function!');
        delay = parseInt(delay) || 0;
        let p = Promise.resolve();
        const nv = [],
            f = delay > 0 ? (k) => p = p.then(() => promfn(k).then(res => this.wait(delay, nv.push(res)))) :
            (k) => p = p.then(() => promfn(k));
        for (let item in obj)
            f(item, obj);
        return p.then(() => nv);
    }

    static c2p(f) {
        assert(typeof f === 'function', 'c2p (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise((res, rej) => (args.push((err, result) => (err && rej(err)) || res(result)), f.apply(this, args)));
        };
    }

    static c1p(f) {
        assert(typeof f === 'function', 'c1p (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise(res => (args.push((result) => res(result)), f.apply(this, args)));
        };
    }

    static c1pe(f) { // one parameter != null = error
        assert(typeof f === 'function', 'c1pe (f) error: f is not a function!');
        return function () {
            const args = Array.prototype.slice.call(arguments);
            return new Promise((res, rej) => (args.push((result) => !result ? res(result) : rej(result)), f.apply(this, args)));
        };
    }

    static retry(nretry, fn, arg, wait) {
        assert(typeof fn === 'function', 'retry (,fn,) error: fn is not a function!');
        nretry = parseInt(nretry);
        nretry = isNaN(nretry) ? 2 : nretry;
        return Promise.resolve(fn(arg)).catch(err => nretry <= 0 ? this.reject(err) : this.wait(wait > 0 ? wait : 0).then(() => this.retry(nretry - 1, fn, arg, wait)));
    }

    static
    while ( /** function */ fw, /** function */ fn, /** number */ time) {
        assert(typeof fw === 'function' && typeof fn === 'function', 'retry (fw,fn,) error: fw or fn is not a function!');
        time = parseInt(time) || 0;
        return !fw() ? this.resolve(true) :
            fn().then(() => true, () => true)
            .then(() => this.wait(time))
            .then(() => this.while(fw, fn, time));
    }

    static repeat( /** number */ nretry, /** function */ fn, arg, /** number */ len) {
        assert(typeof fn === 'function', 'repeat (,fn,) error: fn is not a function!');
        nretry = parseInt(nretry) || 0;
        return fn(arg)
            .then(res => this.reject(res))
            .catch(res => nretry <= 0 ? this.resolve(res) : this.wait(len > 0 ? len : 0).then(() => this.repeat(nretry - 1, fn, arg)));
    }

    static exec(command) {
        assert(typeof command === "string", 'exec (fn) error: fn is not a string!');
        const istest = command.startsWith('!');
        return new Promise((resolve, reject) => {
            try {
                exec(istest ? command.slice(1) : command, (error, stdout, stderr) => {
                    if (istest && error) {
                        error[stderr] = stderr;
                        return reject(error);
                    }
                    resolve(stdout);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    static url(turl, opt) {
        //        this.D(`mup start: ${this.O(turl)}: ${this.O(opt)}`);
        if (typeof turl === 'string')
            turl = url.parse(turl.trim(), true);
        if (this.T(opt) === 'object') {
            opt = this.clone(opt);
            if (!turl || !(turl instanceof url.Url))
                turl = new url.Url(opt.url);
            for (var i of Object.keys(opt))
                if (opt.hasOwnProperty(i) && i !== 'url') turl[i] = opt[i];
        }
        //        this.D(`mup ret: ${this.O(turl)}`);
        return turl;
    }

    static request(opt, value, transform) {
        if (typeof opt === 'string')
            opt = this.url(opt.trim());
        if (!(opt instanceof url.Url)) {
            if (this.T(opt) !== 'object' || !opt.hasOwnProperty('url'))
                return Promise.reject(this.W(`Invalid opt or Url for request: ${this.O(opt)}`));
            opt = this.url(opt.url, opt);
        }
        if (opt.json)
            if (opt.headers) opt.headers.Accept = 'application/json';
            else opt.headers = {
                Accept: 'application/json'
            };
        if (!opt.protocol)
            opt.protocol = 'http:';
        let fun = opt.protocol.startsWith('https') ? https.request : http.request;
        //                this.D(`opt: ${this.O(opt)}`);
        return new Promise((resolve, reject) => {
            let data = new Buffer(''),
                res;
            const req = fun(opt, function (result) {
                res = result;
                //                MyAdapter.D(`status: ${MyAdapter.O(res.statusCode)}/${http.STATUS_CODES[res.statusCode]}`);
                res.setEncoding(opt.encoding ? opt.encoding : 'utf8');
                if (MyAdapter.T(opt.status) === 'array' && opt.status.indexOf(res.statusCode) < 0)
                    return reject(MyAdapter.D(`request for ${url.format(opt)} had status ${res.statusCode}/${http.STATUS_CODES[res.statusCode]} other than supported ${opt.status}`));
                res.on('data', chunk => data += chunk)
                    .on('end', () => {
                        //                        res.removeAllListeners();
                        //                        req.removeAllListeners();
                        if (MyAdapter.T(transform) === 'function')
                            data = transform(data);
                        if (opt.json) {
                            try {
                                return resolve(JSON.parse(data));
                            } catch (e) {
                                return err(`request JSON error ${MyAdapter.O(e)}`);
                            }
                        }
                        return resolve(data);
                    })
                    .on('error', e => err(e))
                    .on('close', () => err(`Connection closed before data was received!`));
            }).on('error', e => err(e));

            function err(e, msg) {
                if (!msg)
                    msg = e;
                //                if (res) res.removeAllListeners();
                //                req && req.removeAllListeners();
                //                if (req && !req.aborted) req.abort();
                //                res && res.destroy();
                //                MyAdapter.Df('err in response: %s = %O', msg);
                return reject(msg);
            }

            if (opt.timeout)
                req.setTimeout(opt.timeout, () => err('request timeout Error: ' + opt.timeout + 'ms'));
            req.on('error', (e) => err('request Error: ' + MyAdapter.O(e)))
                .on('aborted', (e) => err('request aborted: ' + MyAdapter.O(e)));
            // write data to request body
            return req.end(value, opt.encoding ? opt.encoding : 'utf8');
        });
    }

    static get(url, retry) { // get a web page either with http or https and return a promise for the data, could be done also with request but request is now an external package and http/https are part of nodejs.
        const fun = typeof url === 'string' && url.trim().toLowerCase().startsWith('https') ||
            url.protocol === 'https' ? https.get : http.get;
        return (new Promise((resolve, reject) => {
            fun(url, (res) => {
                if (res.statusCode !== 200) {
                    const error = new Error(`Request Failed. Status Code: ${res.statusCode}`);
                    res.resume(); // consume response data to free up memory
                    return reject(error);
                }
                res.setEncoding('utf8');
                let rawData = '';
                res.on('data', (chunk) => rawData += chunk);
                res.on('end', () => resolve(rawData));
            }).on('error', (e) => reject(e));
        })).catch(err => !retry ? this.reject(err) : this.wait(100, retry - 1).then(a => this.get(url, a)));
    }

    static equal(a, b) {
        /*jshint -W116 */
        if (a == b)
            /*jshint +W116 */
            return true;
        let ta = this.T(a),
            tb = this.T(b);
        if (ta === tb) {
            if (ta === 'array' || ta === 'function' || ta === 'object')
                return JSON.stringify(a) === JSON.stringify(b);
        } else if (ta === 'string' && (tb === 'array' || tb === 'function' || tb === 'object') && a === this.O(b))
            return true;
        return false;
    }

    static changeState(id, value, ack, always) {
        //        this.If('ChangeState got called on %s with ack:%s = %O', id,ack,value)
        if (value === undefined) return this.resolve();
        assert(typeof id === 'string', 'changeState (id,,,) error: id is not a string!');
        always = always === undefined ? false : !!always;
        let ts = typeof ack === 'number' ? ack : undefined;
        ack = ack === undefined ? true : !!ack;
        let stn = {
            val: value,
            ack: ack
        }
        if (ts) stn.ts = ts;
        return (this.states[id] ? Promise.resolve(this.states[id]) : this.getState(id).then(st => this.states[st] = st, () => null))
            .then(st => st && !always && this.equal(st.val, value) && st.ack === ack && ack ? this.resolve(st) :
                this.setState(id, stn).then(this.nop, this.setState(id, stn))
                .then(() => {
                    if (states[id]) {
                        states[id].val = value;
                        states[id].ack = ack;
                        if (ts)
                            states[id].ts = ts;
                    }
                    this.Df('ChangeState ack:%s of %s = %s', ack, id, value);
                }, err => this.W(`Error in MyAdapter.setState(${id},${value},${ack}): ${err}`)));
    }

    static getClass(obj) {
        if (typeof obj === "undefined")
            return "undefined";
        if (obj === null)
            return "null";
        let ret = Object.prototype.toString.call(obj)
            .match(/^\[object\s(.*)\]$/)[1];
        //            this.I(this.F('get class of ',obj, ' = ', ret));
        return ret;
    }

    static myGetState(id) {
        if (states[id])
            return Promise.resolve(states[id]);
        var nid = this.sstate[id];
        if (nid && this.states[nid])
            return Promise.resolve(states[nid]);
        if (!nid)
            nid = id;
        return this.getForeignState(nid)
            .then(s => states[nid] = s, () => this.reject(`Could not find state "${id + '(' + nid})"`));
    }


    static makeState(ido, value, ack, always, define) {
        //        ack = ack === undefined || !!ack;
        //                this.Df(`Make State %s and set value to:%O ack:%s`,typeof ido === 'string' ? ido : ido.id,value,ack); ///TC
        let id = ido;
        if (typeof id === 'string')
            ido = id.endsWith('Percent') ? {
                unit: "%"
            } : {};
        else if (typeof id.id === 'string') {
            id = id.id;
        } else return this.reject(this.W(`Invalid makeState id: ${this.O(id)}`));

        if ((!define || typeof ido !== 'object') && (states[id] || states[this.ain + id]))
            return this.changeState(id, value, ack, always);

        //        this.Df(`Make State ack:%s %s = %s`, ack, id, value); ///TC
        const st = {
            common: {
                name: id, // You can add here some description
                read: true,
                write: false,
                state: 'state',
                role: 'value',
                type: this.T(value)
            },
            type: 'state',
            _id: id
        };
        if (st.common.type === 'object') st.common.type = 'mixed';
        for (let i in ido) {
            if (i === 'native') {
                st.native = st.native || {};
                for (let j in ido[i])
                    st.native[j] = ido[i][j];
            } else if (i !== 'id' && i !== 'val') st.common[i] = ido[i];
        }
        if (st.common.write)
            st.common.role = st.common.role.replace(/^value/, 'level');
        //    this.I(`will create state:${id} with ${this.O(st)}`);
        addSState(id, this.ain + id);
        states[this.ain + id] = states[id] = st;
        return this.extendObject(id, st, null)
            //            .then(x => states[id] = x)
            .then(() => st.common.state === 'state' ? this.changeState(id, value, ack, always) : true)
            .catch(err => this.D(`MS ${this.O(err)}`, id));
    }

    static cleanup(name) {
        //        .then(() => A.I(A.F(A.sstate)))
        //        .then(() => A.I(A.F(A.ownKeysSorted(A.states))))
        return this.getObjects(name)
            .then(res => {
                //                this.If('got items %O',res);
                return this.seriesOf(res, item => { // clean all states which are not part of the list
                    //            this.I(`Check ${this.O(item)}`);
                    if (!item.id.startsWith(this.ain))
                        return this.resolve();
                    let id = item.id.slice(this.ain.length);
                    //            this.I(`check state ${item.id} and ${id}: ${this.states[item.id]} , ${this.states[id]}`);
                    if (!id || this.states[item.id] || this.states[id])
                        return this.resolve();
                    this.Df('Cleanup and delete item %s', id);
                    return this.deleteState(id)
                        .catch(err => this.D(`Del State err: ${this.O(err)}`)) ///TC
                        .then(() => this.delObject(id))
                        .catch(err => this.D(`Del Object err: ${this.O(err)}`)); ///TC
                }, 10);
            });

    }

    static isLinuxApp(name) {
        if (os.platform() !== 'linux')
            return false;
        return this.exec('!which ' + name).then(x => x.length >= name.length, () => false);
    }
}

MyAdapter._util = util;
MyAdapter._fs = fs;
MyAdapter._assert = assert;
MyAdapter._http = http;
MyAdapter._https = https;
MyAdapter._url = url;
MyAdapter._dns = dns;
MyAdapter._os = os;
MyAdapter._child_process = require('child_process');
MyAdapter.Sequence = Sequence;
MyAdapter.Setter = Setter;
MyAdapter.CacheP = CacheP;
MyAdapter.Hrtime = Hrtime;
exports.MyAdapter = MyAdapter;