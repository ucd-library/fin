import {html} from 'lit';
import {unsafeHTML} from 'lit/directives/unsafe-html.js';

function replaceWhitespace(str='') {
  if( str === null || str === undefined ) return '';
  return str.replace(/ /g, '&nbsp;').replace(/\n/g, '<br />')
}

const viewConfig = {

  'dbsync-main' : {
    table : 'dbsync_update_status',
    query : {
      limit : 10
    },
    renderCellValue : (row, key) => {
      if( key === 'container_types' || key === 'update_types') {
        return row[key].join(', ');
      } else if( key === 'source' || key === 'db_response') {
        if( row[key] ) {
          return html`${unsafeHTML(
            replaceWhitespace(JSON.stringify(row[key], null, 2))
          )}`;
        }
        return '';
      } else if( key === 'message' ) {
          return html`${unsafeHTML(replaceWhitespace(row[key]))}`;
      } else {
        return row[key];
      }
    }
  },

  'workflows-main' : {
    table : 'workflow_workflow',
    query : {
      limit : 10
    },
    renderCellValue : (row, key) => {
      if( key === 'data' ) {
        if( row[key] ) {
          return html`${unsafeHTML(
            replaceWhitespace(JSON.stringify(row[key], null, null))
          )}`;
        }
        return '';
      }
      return row[key];
    }
  },

  'dashboard-dbsync-stats' : {
    table : 'dbsync_stats',
    renderCellValue : (row, key) => {
      if( key === 'action' ) {
        return html`<a href="#dbsync?action=eq.${row[key]}">${row[key]}</a>`;
      } else {
        return row[key];
      }
    }
  },

  'dashboard-gcs-diskcache-largest' : {
    table : 'gcssync_disk_cache',
    ignoreKeys: ['file_md5'],
    query : {
      limit : 10,
      order : 'size.desc'
    }
  }

}

export default viewConfig;