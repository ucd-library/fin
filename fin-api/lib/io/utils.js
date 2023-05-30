const fs = require('fs');
const path = require('path');
const transform = require('../utils/transform');
class IoUtils {

  constructor() {
    this.ACL_FILE = 'acl.ttl'

    // if you want to add additional container graph file types, make sure
    // to updates this arrays as well as add a parser to parseContainerGraphFile
    this.CONTAINER_FILE_EXTS = ['.ttl', '.jsonld.json'];
    this.CONTAINER_FILE_EXTS_REGEX = /(\.ttl|\.jsonld\.json)$/;

    this.GIT_SOURCE_PROPERTY_BASE = 'http://digital.ucdavis.edu/schema#git/';
    this.LDP_SCHEMA = ['http://www.w3.org/ns/ldp#', 'ldp:'];
    this.FEDORA_SCHEMA = ['http://fedora.info/definitions/v4/repository#', 'fedora:'];
    this.KNOWN_PREFIX = {
      'ldp:' : 'http://www.w3.org/ns/ldp#',
      'fedora:' : 'http://fedora.info/definitions/v4/repository#'
    };

    this.TYPES = {
      ARCHIVAL_GROUP : 'http://fedora.info/definitions/v4/repository#ArchivalGroup',
      INDIRECT_CONTAINER : 'http://www.w3.org/ns/ldp#IndirectContainer',
      COLLECTION : 'http://schema.org/Collection',
      GIT_SOURCE : 'http://digital.ucdavis.edu/schema#GitSource',
      FIN_IO : 'http://digital.ucdavis.edu/schema#FinIoContainer',
      FIN_IO_INDIRECT_REFERENCE : 'http://digital.ucdavis.edu/schema#FinIoIndirectReference'
    }

    this.PROPERTIES = {
      SCHEMA : {
        IDENTIFIER : 'http://schema.org/identifier',
        IS_PART_OF : 'http://schema.org/isPartOf',
        HAS_PART : 'http://schema.org/hasPart'
      },
      PREMIS : {
        HAS_MESSAGE_DIGEST : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest'
      },
      FIN_IO : {
        METADATA_SHA : 'http://digital.ucdavis.edu/schema#finIoMetadataSha256',
        METADATA_MD5 : 'http://digital.ucdavis.edu/schema#finIoMetadataMd5',
        INDIRECT_REFERENCE_SHA : 'http://digital.ucdavis.edu/schema#finIoIndirectReferenceSha'
      },
      LDP : {
        CONTAINS : 'http://www.w3.org/ns/ldp#contains',
        MEMBERSHIP_RESOURCE : 'http://www.w3.org/ns/ldp#membershipResource',
        IS_MEMBER_OF_RELATION : 'http://www.w3.org/ns/ldp#isMemberOfRelation',
        IS_MEMBER_OF_RELATION_SHORT : 'ldp:isMemberOfRelation',
        HAS_MEMBER_RELATION : 'http://www.w3.org/ns/ldp#hasMemberRelation',
        HAS_MEMBER_RELATION_SHORT : 'ldp:hasMemberRelation',
        INSERTED_CONTENT_RELATION : 'http://www.w3.org/ns/ldp#insertedContentRelation'
      }
    }

    this.GRAPH_NODES = {
      GIT_SOURCE : '#gitsource',
      FIN_IO : '#finio'
    }

    // types that must be set in the header


    this.TO_HEADER_TYPES = [
      'http://www.w3.org/ns/ldp#DirectContainer',
      'http://www.w3.org/ns/ldp#IndirectContainer',
      'http://fedora.info/definitions/v4/repository#ArchivalGroup',
    ]
  }

  /**
   * @method parseContainerGraphFile
   * @description extension specific loading of container files. If you want
   * to add additional container graph files, do it hear
   * 
   * @param {String} filePath
   * @returns {Object|null} 
   */
  async parseContainerGraphFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let jsonld = null;

    if( path.parse(filePath).ext === '.ttl' ) {
      jsonld = await transform.turtleToJsonLd(content);
    } else if( filePath.match(/\.jsonld\.json$/) ) {
      jsonld = JSON.parse(content);
    }

    return jsonld
  }

  /**
   * @method cleanupContainerNode
   * @description multifaceted method.  Preforms clean up of types that
   * must be set in the header.  Additionally hads some hacks for w3c spec
   * badness
   */
  cleanupContainerNode(node={}, headers={}, current) {
    // strip @types that must be provided as a Link headers
    if( node['@type'] ) {
      if( !Array.isArray(node['@type']) ) node['@type'] = [node['@type']];
      console.log(`  - @type: ${node['@type'].join(', ')}`);
      this.TO_HEADER_TYPES.forEach(type => {
        let typeName = this.isNodeOfType(node, type, node['@context'], {returnExpanded: true});
        if( !typeName ) return;

        node['@type'] = node['@type'].filter(item => item !== typeName);
        console.log(`  - current container status: ${current ? current.last.statusCode : 'unknown'}`);
        if( current && current.last.statusCode !== 200 ) {
          if( !headers.link ) headers.link = [];
          headers.link.push(`<${type}>;rel="type"`)
          console.log(`  - creating ${type.replace(/.*#/, '')}`);
        }
      })

      // strip all ldp (and possibly fedora properties)
      let prefixes = [this.LDP_SCHEMA, this.FEDORA_SCHEMA];
      prefixes.forEach(types => {
        types.forEach(type => 
          node['@type'] = node['@type'].filter(item => !item.startsWith(type))
        );
      });
      
    }

    // HACK to work around: https://fedora-repository.atlassian.net/browse/FCREPO-3858
    // Just keeping down direction required by fin UI for now.
    if( node[this.PROPERTIES.LDP.HAS_MEMBER_RELATION] && node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION] ) {
      delete node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];
    }

    let hasMemberRelation = this.PROPERTIES.LDP.HAS_MEMBER_RELATION_SHORT.replace(/^.*:/, '');
    let isMemberOfRelation = this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION_SHORT.replace(/^.*:/, '');
    if( node[hasMemberRelation] && node[isMemberOfRelation] ) {
      delete node[isMemberOfRelation];
    }

    if( node[this.PROPERTIES.LDP.HAS_MEMBER_RELATION_SHORT] && 
        node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION_SHORT] ) {
      delete node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION_SHORT];
    }
  }

  /**
   * @method getMainGraphNode
   * @description a hacky lookup for the 'main' graph node that will be represented for the container.
   * 
   * @param {*} graph 
   * @param {*} id 
   */
  getMainGraphNode(graph, id) {
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];

    let mainNode = null;

    // if there is id given, graph by id
    if( id ) {
      mainNode = this.getGraphNode(graph, id);
      if( mainNode) return mainNode;
    }
    
    // look for empty id node
    mainNode = graph.find(item => item['@id'] !== undefined && item['@id'].trim() === '');
    if( mainNode ) return mainNode;
    
    // finally, do we have an ark node?
    return graph.find(item => item['@id'] && item['@id'].match(/^ark:\//));
  }


  getGraphNode(jsonld, id, context) {
    if( jsonld['@graph'] ) {
      jsonld = jsonld['@graph'];
    }
    if( !Array.isArray(jsonld) ) {
      jsonld = [jsonld];
    }

    let isRe = false;
    if( id instanceof RegExp ) {
      isRe = true;
    }

    for( let node of jsonld ) {
      if( isRe && node['@id'].match(id) ) {
        return node;
      } else if( !isRe ) {
        if( node['@id'] === id ) return node;
        if( this.isNodeOfType(node, id, context) ) return node;
      }
    }

    return null;
  }


  removeGraphNode(graph, typeOrId) {
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];

    let index = graph.findIndex(item => item['@type'] && item['@type'].includes(typeOrId));
    if( index > -1 ) {
      return graph.splice(index, 1);
    }
    return null;
  }


  /**
   * @method getGraphNode
   * @descript this is a hack function.  use with caution.  Given
   * a graph return the first property value for the first node the
   * property is found in.  Purpose.  Binary containers graph only 
   * have one node, so the gitsource and finio nodes are merged.  This
   * simplifies lookup of properties without caring about graph structure. 
   * 
   * @param {Array} graph 
   * @param {String} prop 
   */
  getGraphValue(graph, prop) {
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];

    for( let node of graph ) {
      if( node[prop] && node[prop].length ) {
        return node[prop][0]['@value'];
      } 
    }
    return null;
  }

  applyTypeToNode(node, type) {
    let types = node['@type'] || [];
    if( !Array.isArray(types) ) types = [types];
    if( types.includes(type) ) return;
    types.push(type);
    node['@type'] = types; 
  }

  isNodeOfType(node, type, context, opts={}) {
    let types = node['@type'] || [];
    if( !Array.isArray(types) ) types = [types];
    if( types.includes(type) ) return type;

    if( !context ) return false;

    for( let t of types ) {      
      let prefix = t.split(':')[0];

      if( !context[prefix] ) continue;
      if( context[prefix]+t.split(':')[1] === type ) {
        if( opts.returnExpanded ) {
          return context[prefix]+t.split(':')[1];
        }
        return t;
      }
    }

    return false;
  }

  getPropAsString(metadata, prop, context) {
    prop = this.getProp(metadata, prop, context);
    if( !prop ) return '';
    if( Array.isArray(prop) ) {
      return prop.map(item => this._getPropValueAsString(item));
    }
    return this._getPropValueAsString(prop);
  }

  _getPropValueAsString(value) {
    if( typeof value === 'string' ) return value;
    return value['@id'] || value['@value'];
  }

  getProp(metadata, prop, context) {
    let compacted = prop.split(/#|\//).pop();
    let v = metadata[prop] || metadata[compacted];
    if( v ) return v;

    if( context ) {
      for( let key in context ) {
        if( typeof context[key] !== 'object' ) continue;
        if( context[key]['@id'] === prop ) {
          return metadata[key];
        }
      }
    }
  }

}

module.exports = new IoUtils();