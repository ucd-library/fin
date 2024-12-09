const fs = require('fs');
const path = require('path');
const URL = 'https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry';
const FILE = path.join(__dirname, '..', 'services', 'init', 'fcrepo', 'service', 'lang-label-service.jsonld.json');

const IANALANG = 'https://www.iana.org/assignments/language-subtag-registry#';

const template = [
  {
    "@id": "",
    "@context": {
      "ucdlib": "http://digital.ucdavis.edu/schema#"
    },
    "@type": [
      "ucdlib:LabelService",
      "ucdlib:Service"
    ]
  }
];

(async () => {
  let resp = await fetch(URL);
  let text = await resp.text();
  text = text.replace(/\n\s\s/g, ' ') // cleanup breaks
  let items = text.split('%%');
  
  for( let item of items ) {
    let lines = item.split('\n');
    let obj = {};
    for( let line of lines ) {
      if( !line.trim() ) continue;
      let [key, value] = line.split(':');
      obj[key.trim()] = value.trim();
    }

    // currently only interested in languages
    if( obj.Type !== 'language' ) continue;

    template.push({
      "@id": IANALANG+obj.Subtag,
      "http://schema.org/name": obj.Description
    });
  }

  fs.writeFileSync(
    FILE, 
    JSON.stringify(template, null, 2)
  );

})();