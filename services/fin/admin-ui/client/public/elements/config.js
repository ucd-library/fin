import {html} from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import bytes from 'bytes';

function replaceWhitespace(str='') {
  if( str === null || str === undefined ) return '';
  return str.replace(/ /g, '&nbsp;').replace(/\n/g, '<br />')
}

const viewConfig = {

  'dashboard-data-models' : {
    columnLabels : {
      dbItemCount : 'Database Items',
      validation_comment_count : 'Comments',
      validation_error_count : 'Errors',
      validation_warning_count : 'Warnings'
    },
    actions : [{      type : 'view-info',
      label : 'View Info'
    }],
    renderCellValue : (row, key) => {
      if ( ['validation_error_count', 'validation_warning_count', 'validation_comment_count'].includes(key) ) {
        if( row[key] === undefined || row[key] === null ) return '';
        let filterKey = key.replace('validation_', '');
        return html`<a href="#data-validation?limit=10&order=db_id.asc&${filterKey}=gt.0&model=eq.${row.name}">${row[key]}</a>`;
      }
      return standardRender(row, key);
    }
  },

  'data-validation-main' : {
    table : 'dbsync_validate_response_view',
    ignoreKeys : ['comment_count', 'error_count', 'warning_count'],
    renderCellValue : (row, key) => {
      if( key === 'paths' ) {
        row[key].sort((a, b) => a < b ? -1 : 1);
        return row[key].map(path => {
          return html`<div><a href="#path-info${path}">${path}</a></div>`;
        });
      }
      return standardRender(row, key);
    },
    columnLabels : {
      'db_id' : 'Database ID',
      'paths' : 'Fcrepo Paths'
    },
    filters : {
      db_id : {
        type : 'text'
      },
      model : {
        type : 'keyword',
        options : []
      },
      validation : {
        type : 'custom',
        options : [
          {label: 'Has Errors', query : {error_count: 'gt.0'}},
          {label: 'Has Warnings', query : {warning_count: 'gt.0'}},
          {label: 'Has Comments', query : {comment_count: 'gt.0'}}
        ]
      }
    },
    renderCellClass : (row, key) => {
      if( key === 'paths' ) return 'scrollable';
      return '';
    }
  },

  'dbsync-main' : {
    table : 'dbsync_update_status',
    query : {
      limit : 10,
      order : 'path.asc'
    },
    columnLabels : {
      db_id : 'Database ID',
      validation_response : 'Data Model Validation'
    },
    ignoreKeys : ['validate_response_id', 'validation_comment_count', 'validation_error_count', 'validation_warning_count'],
    keySort : ['path', 'model', 'action', 'message', 'updated', 'container_types', 'workflow_types',
      'transform_service', 'update_types', 'db_response', 'update_count', 'db_id', 'validation_response'],
    renderCellValue : dbsync,
    filters : {
      action : {
        type : 'keyword',
        options: ['ignored', 'updated', 'delete', 'error']
      },
      model : {
        type : 'keyword',
        options : []
      },
      validation : {
        type : 'custom',
        options : [
          {label: 'Has Errors', query : {validation_error_count: 'gt.0'}},
          {label: 'Has Warnings', query : {validation_warning_count: 'gt.0'}},
          {label: 'Has Comments', query : {validation_comment_count: 'gt.0'}}
        ]
      }
    },
    actions : [{
      type : 'reindex',
      label : 'Reindex Path'
    }]
  },

  'path-info-dbsync' : {
    columnLabels : {
      db_id : 'Database ID',
      response : 'Data Model Validation',
    },
    keySort : ['path', 'model', 'action', 'message', 'updated', 'container_types', 'workflow_types',
    'transform_service', 'update_types', 'db_response', 'update_count'],
  renderCellValue : dbsync,
    ignoreKeys : ['validate_response_id', 'validation_comment_count', 'validation_error_count', 'validation_warning_count'],
    renderCellValue : dbsync,
    keySort : ['path', 'model', 'action', 'message', 'updated', 'container_types', 'workflow_types',
              'transform_service', 'update_types', 'db_response', 'update_count', 'db_id',
            'validation_response']
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

  'path-info-gcssync' : {
    table : 'gcssync_update_state',
    ignoreKeys : ['update_status_id', 'gcs_path', 'gcs_bucket'],
    columnLabels : {
      path : 'GCS Path'
    },
    renderCellValue : (row, key) => {
      if( key === 'path' ) {
        return html`gs://${row.gcs_bucket}/${row.gcs_path}`;
      }
      return standardRender(row, key);
    }
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

  'dashboard-gcs-diskcache-stats' : {
    renderCellValue : (row, key) => {
      if( key === 'total_size_kb' ) {
        return bytes(row[key]*1000);
      }
      return standardRender(row, key);
    },
    columnLabels : {
      total_size_kb : 'Total Size',
    }
  },

  'dashboard-gcs-diskcache-largest' : {
    table : 'gcssync_disk_cache',
    ignoreKeys: ['file_md5', 'disk_cache_id'],
    query : {
      limit : 10,
      order : 'size.desc'
    },
    renderCellValue : (row, key) => {
      if( key === 'size' ) {
        return bytes(row[key]*1000);
      }
      return standardRender(row, key);
    },
    columnLabels : {
      size : 'Size',
    }
  },

  'open-transactions' : {
    columnLabels : {
      session_id : 'Open OCFL Session ID',
    },
    actions : [{
      type : 'delete-tx',
      label : 'Delete Transaction',
      filter : row => row.transaction_id !== ''
    }]
  },

  'gcs-gcssync' : {
    query : {
      limit : 10,
      order : 'path.asc'
    },
    table : 'gcssync_update_state',
    ignoreKeys : ['update_status_id', 'gcs_path', 'gcs_bucket'],
    renderCellValue : (row, key) => {
      if( key === 'path' ) {
        return html`<a href="#path-info${row.path}">${row.path}</a><br />gs://${row.gcs_bucket}/${row.gcs_path}`;
      }
      return standardRender(row, key);
    }
  },

  'health-last-events' : {
    // ignoreKeys : ['id']
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
    if( !row[key] ) return '';
    return row[key].map(item => {
      if( typeof item === 'object' ) {
        item = item.url;
      } else if( item.match(/^{.*}$/) ) {
        item = JSON.parse(item).url;
      }
      return item.split(/#|\//).pop()
    }).join(', ');
  } else if( key === 'db_id' ) {
    return html`<a href="#data-validation?db_id=eq.${row.db_id}&model=eq.${row.model}">${row[key]}</a>`;
  } else if( key === 'message' ) {
      return html`${unsafeHTML(replaceWhitespace(row[key]))}`;
  } else if ( key === 'transform_service' && row[key] ) {
    return html`<a href="${row[key]}" target="_blank">${row[key]}</a>`;
  }
  return standardRender(row, key);
}

export default viewConfig;