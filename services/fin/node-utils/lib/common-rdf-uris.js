module.exports = {

  SCHEMA_BASE : {
    SCHEMA_ORG : 'http://schema.org/'
  },

  NODE_HASH : {
    FIN_GCSSYNC_METADATA : '#fin-gcssync-metadata',
  },

  TYPES : {
    AUTHORIZATION : 'http://www.w3.org/ns/auth/acl#Authorization',
    BINARY : 'http://fedora.info/definitions/v4/repository#Binary',
    NON_RDF_SOURCE : 'http://www.w3.org/ns/ldp#NonRDFSource',
    FIN_IO_INDIRECT : 'http://digital.ucdavis.edu/schema#FinIoIndirectReference',
    FIN_GCSSYNC_METADATA : 'http://digital.ucdavis.edu/schema#FinGcsSyncContainer',
    FIN_IO_METADATA : 'http://digital.ucdavis.edu/schema#FinIoContainer',
    WEBAC : 'http://fedora.info/definitions/v4/webac#Acl',
    ARCHIVAL_GROUP : 'http://fedora.info/definitions/v4/repository#ArchivalGroup',
    FIN_GROUP : 'http://digital.ucdavis.edu/schema#FinGroup'
  },

  PROPERTIES : {
    CONTAINS : 'http://www.w3.org/ns/ldp#contains',
    HAS_PART : 'http://schema.org/hasPart',
    HAS_MESSAGE_DIGEST : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest',
    LAST_MODIFIED : 'http://fedora.info/definitions/v4/repository#lastModified',
    FILENAME : 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#filename',
    HAS_MIME_TYPE : 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#hasMimeType',
    GCSSYNC_METADATA_MD5 : 'http://digital.ucdavis.edu/schema#finGcsSyncMetadataMd5',
    GCSSYNC_GCS_PATH : 'http://digital.ucdavis.edu/schema#finGcsSyncPath',
    FIN_IO_METADATA_MD5 : 'http://digital.ucdavis.edu/schema#finIoMetadataMd5',
    FIN_IO_METADATA_SHA256 : 'http://digital.ucdavis.edu/schema#finIoMetadataSha256',
    FIN_IO_METADATA_SHA512 : 'http://digital.ucdavis.edu/schema#finIoMetadataSha512'
  }

};