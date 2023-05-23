const {logger, config, jwt, workflow, FinAC, pg} = require('@ucd-lib/fin-service-utils');


/**
 * @class FcrepoTransactionWrapper
 * @description Adding functionality for transaction administration
 */
class FcrepoTransactionWrapper {

  constructor() {

  }

  async getOpenTransaction(path) {
    path = path.replace(/^\/fcrepo\/rest/, '');
    path = 'info:fedora'+path;

    let resp = await pg.query(`select 
        ct.transaction_id as txid_1
      from 
        containment_transactions ct
      where
        ct.fedora_id = $1
      limit 1
    `, [path]);

    if( resp.rows && resp.rows.length ) {
      let row = resp.rows[0];
      if( row.txid_1 ) return row.txid_1;
    }

    return '';
  }

  async getTransactionStats() {
    let resp = await pg.query(`select 
      transaction_id, count(*) as count 
    from 
      containment_transactions 
    group by 
      transaction_id
    `);
    return resp.rows;
  }

  async getTransactionInfo(txid) {
    let resp = await pg.query(`select * 
      from 
        containment_transactions 
      where 
        transaction_id = $1`, 
      [txid]
    );
    return resp.rows;
  }

  /**
   * @method nukeTransaction
   * @description remove all traces of a transaction from the database.  This
   * is a total hack to get around fcrepo tx issues.  Fcrepo will need to be restarted
   * after calling this method.
   * 
   * @param {String} txid
   * 
   * @returns {Promise} 
   */
  async nukeTransaction(txid) {
    await pg.query(`delete from containment_transactions where transaction_id = $1`, [txid]);
    await pg.query(`delete from membership_tx_operations where tx_id = $1`, [txid]);
    await pg.query(`delete from ocfl_id_map_session_operations where session_id = $1`, [txid]);
    await pg.query(`delete from reference_transaction_operations where transaction_id = $1`, [txid]);
    await pg.query(`delete from search_resource_rdf_type_transactions where transaction_id = $1`, [txid]);
    await pg.query(`delete from simple_search_transactions where transaction_id = $1`, [txid]);
  }

}

module.exports = new FcrepoTransactionWrapper();