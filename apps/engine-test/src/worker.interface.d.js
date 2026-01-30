
/** 
 * @typedef {Rec}
 * @prop {string} name
 * @prop {string} id
*/  

// we are declaring classes taht will not be imported by code, but by jsdoc only to provide type

// there is no good way in jsdoc to define classes with methods, so this dummy class will do the trick
export class WorkerRpc{
  /**
   * @param {string} _name
   * @param {boolean} _low
   * @returns {Rec}
  */
 getData(_name, _low){}
 /**
  * @param {string} _id
  * @returns {Rec}
 */
getRecord1(_id){}
/**
 * @param {Rec} _tpl
 * @returns {Rec}
*/
  getRecord2(_tpl){}
}
