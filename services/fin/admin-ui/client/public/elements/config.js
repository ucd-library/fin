import {html} from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

function replaceWhitespace(str='') {
  if( str === null || str === undefined ) return '';
  return str.replace(/ /g, '&nbsp;').replace(/\n/g, '<br />')
}

const viewConfig = {

  'dashboard-data-models' : {
    columnLabels : {
      dbItemCount : 'Database Items'
    },
    actions : [{
      type : 'view-info',
      label : 'View Info'
    }]
  },

  'dbsync-main' : {
    table : 'dbsync_update_status',
    query : {
      limit : 10,
      order : 'path.asc'
    },
    keySort : ['path', 'model', 'action', 'message', 'updated', 'container_types', 'workflow_types',
      'transform_service', 'update_types', 'db_response', 'update_count'],
    renderCellValue : dbsync,
    filters : {
      action : {
        type : 'keyword',
        options: ['ignored', 'updated', 'delete', 'error']
      },
      model : {
        type : 'keyword',
        options : []
      }
    },
    actions : [{
      type : 'reindex',
      label : 'Reindex Path'
    }]
  },

  'path-info-dbsync' : {
    renderCellValue : dbsync,
    keySort : ['path', 'model', 'action', 'message', 'updated', 'container_types', 'workflow_types',
              'transform_service', 'update_types', 'db_response', 'update_count']
  },

  'path-info-workflows' : {
    table : 'workflow_lastest',
    keySort : ['path', 'name', 'state', 'workflow_id', 'updated', 
              'created', 'error', 'data', 'type'],
    renderCellValue : standardRender,
    actions : [{
      type : 'delete',
      label : 'Delete'
    }]
  },

  'workflows-main' : {
    table : 'workflow_lastest',
    query : {
      limit : 10,
      order : 'path.asc,name.asc'
    },
    filters : {
      state : {
        type : 'keyword',
        options: ['pending', 'init', 'running', 'completed', 'deleted', 'error']
      }
    },
    keySort : ['path', 'name', 'state', 'workflow_id', 'updated', 
              'created', 'error', 'data', 'type'],
    renderCellValue : (row, key) => {
      if( key === 'path' ) {
        let path = (row[key] || '').replace(/\/fcr:metadata$/, '');
        return html`<a href="#path-info${path}">${row[key]}</a>`;
      }
      return standardRender(row, key);
    },
    actions : [{
      type : 'delete',
      label : 'Delete'
    }]
  },

  'dashboard-fcrepo-stats' : {
    table : 'fcrepo_type_stats',
    hideTotal : true,
  },

  'dashboard-dbsync-stats' : {
    table : 'dbsync_stats',
    hideTotal : true,
    renderCellValue : (row, key) => {
      if( key === 'action' ) {
        return html`<a href="#dbsync?action=eq.${row[key]}">${row[key]}</a>`;
      }
      return standardRender(row, key);
    },
    actions : [{
      type : 'reindex',
      label : 'Reindex All'
    }]
  },

  'dashboard-workflow-stats' : {
    table : 'workflow_stats',
    hideTotal : true,
    renderCellValue : (row, key) => {
      if( key === 'state' || key === 'name' ) {
        return html`<a href="#workflows?name=eq.${row.name}&state=eq.${row.state}">${row[key]}</a>`;
      }
      return standardRender(row, key);
    },
    actions : [{
      type : 'delete',
      label : 'Delete All',
      filter : row => row.state === 'error'
    }]
  },

  'dashboard-gcs-diskcache-largest' : {
    table : 'gcssync_disk_cache',
    ignoreKeys: ['file_md5', 'disk_cache_id'],
    query : {
      limit : 10,
      order : 'size.desc'
    },
    renderCellValue : standardRender,
    columnLabels : {
      size : 'Size (KB)',
    }
  },

  'open-transactions' : {
    actions : [{
      type : 'delete-tx',
      label : 'Delete Transaction'
    }]
  }

}

function standardRender(row, key) {
  let value = row[key];
  if( Array.isArray(value) ) {
    return html`${unsafeHTML(formatJson(value))}`;
  }
  if( typeof value === 'object' ) {
    return html`${unsafeHTML(formatJson(value))}`;
  }
  if( typeof value === 'string' && value.match(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d/) ) {
    return new Date(new Date(value).getTime() - (new Date().getTimezoneOffset()*60*1000)).toLocaleString();
  }
  return value;
}

function formatJson(json, arr=[], currentKey='', depth=0) {


  if( Array.isArray(json) ) {
    for( let i = 0; i < json.length; i++ ) {
      formatJson(json[i], arr, `${currentKey}[${i}]`, depth+1);
    }
  } else if( typeof json === 'object' ) {
    for( let key in json ) {
      let depthKey = currentKey ? `${currentKey}.${key}` : key;
      formatJson(json[key], arr, depthKey, depth+1);
    }
  } else {
    arr.push(`<div class="json-row">
        <span class="json-key depth-${depth}">${currentKey}:</span>
        <span class="json-value">${json}</span>
      </div>`);
  }
  

  return arr.join('');
}

function dbsync(row, key) {
  if( key === 'path' ) {
    let path = (row[key] || '').replace(/\/fcr:metadata$/, '');
    return html`<a href="#path-info${path}">${row[key]}</a>`;
  } else if( key === 'container_types' || key === 'update_types' || key === 'workflow_types') {
    return row[key].map(item => {
      if( typeof item === 'object' ) {
        item = item.url;
      } else if( item.match(/^{.*}$/) ) {
        item = JSON.parse(item).url;
      }
      return item.split(/#|\//).pop()
    }).join(', ');
  } else if( key === 'message' ) {
      return html`${unsafeHTML(replaceWhitespace(row[key]))}`;
  } else if ( key === 'transform_service' && row[key] ) {
    return html`<a href="${row[key]}" target="_blank">${row[key]}</a>`;
  }
  return standardRender(row, key);
}

export default viewConfig;