module.exports = {

  SCHEMA_BASE : {
    SCHEMA_ORG : 'http://schema.org/'
  },

  NODE_HASH : {
    FIN_IO_GCS_METADATA : '#finio-gcs-metadata',
  },

  TYPES : {
    BINARY : 'http://fedora.info/definitions/v4/repository#Binary',
    FIN_IO_INDIRECT : 'http://digital.ucdavis.edu/schema#FinIoIndirectReference',
    FIN_IO_GCS_METADATA : 'http://digital.ucdavis.edu/schema#FinIoGcsMetadata',
    WEBAC : 'http://fedora.info/definitions/v4/webac#Acl',
    ARCHIVAL_GROUP : 'http://fedora.info/definitions/v4/repository#ArchivalGroup'
  },

  PROPERTIES : {
    CONTAINS : 'http://www.w3.org/ns/ldp#contains',
    HAS_MESSAGE_DIGEST : 'http://www.loc.gov/premis/rdf/v1#hasMessageDigest',
    FILENAME : 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#filename',
    HAS_MIME_TYPE : 'http://www.ebu.ch/metadata/ontologies/ebucore/ebucore#hasMimeType',
    FIN_IO_GCS_METADATA_MD5 : 'http://digital.ucdavis.edu/schema#FinIoGcsMetadataMd5',
    FIN_IO_GCS_PATH : 'http://digital.ucdavis.edu/schema#FinIoGcsPath',
  }

};