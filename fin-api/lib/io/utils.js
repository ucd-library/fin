const fs = require('fs-extra');
const path = require('path');
const jsonld = require('jsonld');
const transform = require('../utils/transform');
class IoUtils {

  constructor() {
    this.ACL_FILE = 'acl.ttl'

    // if you want to add additional container graph file types, make sure
    // to updates this arrays as well as add a parser to parseContainerGraphFile
    this.CONTAINER_FILE_EXTS = ['.ttl', '.jsonld.json'];
    this.CONTAINER_FILE_EXTS_REGEX = /(\.ttl|\.jsonld\.json)$/;

    this.GIT_SOURCE_PROPERTY_BASE = 'http://digital.ucdavis.edu/schema#git-';
    this.LDP_SCHEMA = 'http://www.w3.org/ns/ldp#';
    this.FEDORA_SCHEMA = 'http://fedora.info/definitions/v4/repository#';

    this.TYPES = {
      BINARY : 'http://fedora.info/definitions/v4/repository#Binary',
      ARCHIVAL_GROUP : 'http://fedora.info/definitions/v4/repository#ArchivalGroup',
      FIN_ARCHIVAL_GROUP : 'http://digital.ucdavis.edu/schema#FinArchivalGroup',
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
        HAS_MEMBER_RELATION : 'http://www.w3.org/ns/ldp#hasMemberRelation',
        INSERTED_CONTENT_RELATION : 'http://www.w3.org/ns/ldp#insertedContentRelation'
      }
    }

    this.UCD_BASE_URI = 'http://digital.ucdavis.edu/schema/baseContainerPath/';

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
    let content = await fs.readFile(filePath, 'utf-8');
    let graph = null;

    // support custom @base:
    content = content.replace(/"@base:/g, '"'+this.UCD_BASE_URI);

    if( path.parse(filePath).ext === '.ttl' ) {
      graph = await transform.turtleToJsonLd(content);
    } else if( filePath.match(/\.jsonld\.json$/) ) {
      graph = JSON.parse(content);
    }

    graph = await jsonld.expand(graph);
    graph = this.graphAsArray(graph);

    this.fixEmptyIds(graph);
    // graph.forEach(node => {
    //   if( node['@id'] === './' ) node['@id'] = '';
    //   if( node['@id'] === '.' ) node['@id'] = '';
    // });

    return graph;
  }

  fixEmptyIds(object) {
    if( Array.isArray(object) ) {
      return object.forEach(item => this.fixEmptyIds(item));
    }

    if( object['@id'] ) {
      if( object['@id'] === './' || object['@id'] === '.' ) {
        object['@id'] = '';
      }
    }
    
    if( object['graph'] ) {
      return this.fixEmptyIds(object['graph']);
    }

    if( typeof object !== 'object' ) return;

    for(let prop in object ) {
      this.fixEmptyIds(object[prop]);
    }
  }

  /**
   * @method cleanupContainerNode
   * @description multifaceted method.  Preforms clean up of types that
   * must be set in the header.  Additionally hads some hacks for w3c spec
   * badness
   */
  cleanupContainerNode(node={}, headers={}, currentContainerExists=false) {
    // strip @types that must be provided as a Link headers
    if( node['@type'] ) {
      if( !Array.isArray(node['@type']) ) node['@type'] = [node['@type']];
      console.log(` -> @type: ${node['@type'].join(', ')}`);
      this.TO_HEADER_TYPES.forEach(type => {
        let typeName = this.isNodeOfType(node, type);
        if( !typeName ) return;

        node['@type'] = node['@type'].filter(item => item !== typeName);
        console.log(` -> current container exists: ${currentContainerExists}`);
        if( currentContainerExists === false ) {
          if( !headers.link ) headers.link = [];
          headers.link.push(`<${type}>;rel="type"`)
          console.log(` -> creating ${type.replace(/.*#/, '')}`);
        }
      })

      // strip all ldp (and possibly fedora properties)
      let prefixes = [this.LDP_SCHEMA, this.FEDORA_SCHEMA];
      prefixes.forEach(prefix => {
        node['@type'] = node['@type'].filter(item => !item.startsWith(prefix))
      });
      
    }

    // HACK to work around: https://fedora-repository.atlassian.net/browse/FCREPO-3858
    // Just keeping down direction required by fin UI for now.
    if( node[this.PROPERTIES.LDP.HAS_MEMBER_RELATION] && node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION] ) {
      delete node[this.PROPERTIES.LDP.IS_MEMBER_OF_RELATION];
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
    graph = this.graphAsArray(graph);

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


  getGraphNode(jsonld, id) {
    jsonld = this.graphAsArray(jsonld);

    let isRe = false;
    if( id instanceof RegExp ) {
      isRe = true;
    }

    for( let node of jsonld ) {
      if( isRe && node['@id'].match(id) ) {
        return node;
      } else if( !isRe ) {
        if( node['@id'] === id ) return node;
        if( node['@id'] === 'info:fedora'+id ) return node;
        if( this.isNodeOfType(node, id) ) return node;
      }
    }

    return null;
  }


  removeGraphNode(graph, typeOrId) {
    graph = this.graphAsArray(graph);

    let index = graph.findIndex(item => item['@type'] && item['@type'].includes(typeOrId));
    if( index > -1 ) {
      return graph.splice(index, 1);
    }
    return null;
  }


  /**
   * @method getGraphValue
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

  /**
   * @method isNodeOfType
   * @description given a node, check if it is of a given type.  Expects
   * expanded graph/node
   * 
   * @param {Object} node 
   * @param {String|Array} checkType full uri
   * @returns 
   */
  isNodeOfType(node, checkType) {
    let types = node['@type'] || [];
    if( !Array.isArray(checkType) ) checkType = [checkType];
    for( let ct of checkType ) {
      if( types.includes(ct) ) return true;
    }
    
    return false;
  }

  /**
   * @method getPropAsString
   * @description given a node, get the property as a string regardless
   * of it's type.
   * 
   * @param {Object} node expanded node
   * @param {String} prop property to get 
   * @returns 
   */
  getPropAsString(node, prop) {
    prop = this.getProp(node, prop);
    if( !prop ) return '';
    if( Array.isArray(prop) ) {
      return prop.map(item => this._getPropValueAsString(item));
    }
    return this._getPropValueAsString(prop);
  }

  /**
   * @method _getPropValueAsString
   * @description given a property value, return it as a string.  If it's
   * a string, return it.  If it's an object, return the @id or @value
   * 
   * @param {Object|String} value 
   * @returns {String}
   */
  _getPropValueAsString(value) {
    if( typeof value === 'string' ) return value;
    return value['@id'] || value['@value'];
  }

  getProp(node, prop) {
    return node[prop];
  }

  /**
   * @method graphAsArray
   * @description given a graph, return the array of nodes.  If single node
   * is passed, it will be wrapped in an array.
   * 
   * @param {Object|Array} graph 
   * @returns {Array}
   */
  graphAsArray(graph) {
    if( graph['@graph'] ) graph = graph['@graph'];
    if( !Array.isArray(graph) ) graph = [graph];
    return graph;
  }

  /**
   * @method isMetadataFile
   * @description given a file path, return true if it is a metadata file
   * (.ttl or .jsonld.json)
   * 
   * @param {String} filePath 
   * @returns 
   */
  isMetadataFile(filePath='') {
    return filePath.match(this.CONTAINER_FILE_EXTS_REGEX) ? true : false;
  }

  /**
   * @method getMetadataFileFor
   * @description strip metadata (.ttl or .jsonld.json) from a file path
   * 
   * @param {String} filePath 
   * @returns {String}
   */
  getMetadataFileFor(filePath) {
    return filePath.replace(this.CONTAINER_FILE_EXTS_REGEX, '');
  }
}

module.exports = new IoUtils();