const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const config = require('../config.js');

class OcflSquash {

  constructor() {
    this.quiet = false;
    this.FILES = {
      INVENTORY : 'inventory.json',
      INVENTORY_SHA : 'inventory.json.sha512',
    }
  }

  log(...args) { 
    if( this.quiet ) return;
    console.log(...args);
  }

  getHash(opts={}) {
    let hashSum = crypto.createHash(opts.type || 'sha512');
    if( opts.data ) {
      hashSum.update(opts.data || '');
    } else if( opts.file ) {
      hashSum.update(fs.readFileSync(opts.file));
    }
    return hashSum.digest('hex').toString();
  }

  versionToNum(version) {
    return parseInt(version.replace(/\D/g, ''));
  }

  loadJsonFile(file) {
    return JSON.parse(fs.readFileSync(file));
  }

  getRootDir(fcrepoPath) {
    fcrepoPath = fcrepoPath.replace(/^\//, '');
    let pathHash = this.getHash({
      data: 'info:fedora/' + fcrepoPath, 
      type: 'sha256'
    });
    return path.join(
      config.ocfl.root, 
      pathHash.substring(0, 3),
      pathHash.substring(3, 6),
      pathHash.substring(6, 9),
      pathHash
    );
  }

  squash(fcrepoPath, toVersion, opts={}) {
    let toVersionInt = this.versionToNum(toVersion);
    let rootDir = this.getRootDir(fcrepoPath);
    let inventoryFilePath = path.join(rootDir, this.FILES.INVENTORY);
    let inventory = this.loadJsonFile(inventoryFilePath);
    let inventoryVersionFilePath = path.join(rootDir, toVersion, this.FILES.INVENTORY);

    let currentVersion = inventory.head;
    this.log(`Squashing OCFL object (${inventory.head} -> ${toVersion}):`, fcrepoPath, rootDir);

    let latestVersion = inventory.versions[inventory.head];
    let shaSet = new Set();
    let filesToMove = [];

    for( let sha in latestVersion.state ) {
      shaSet.add(sha);

      let files = inventory.manifest[sha].map(f => {
        let p = f.split('/');
        p.shift();
        return {
          from: f,
          to: path.join(toVersion, p.join('/'))
        }
      }).filter(f => f.to !== f.from);

      if( files.length ) {
        filesToMove.push({
          sha, file: files
        });
      }
    }
    

    let versionsToRemove = [];
    let filesToRemove = [];

    for( let version in inventory.versions ) {
      let vint = this.versionToNum(version);

      if( vint < toVersionInt ) {
        continue;
      }

      for( let sha in inventory.versions[version].state ) {
        if( shaSet.has(sha) ) {
          continue;
        }
        if( inventory.manifest[sha] ) {
          filesToRemove.push({
            sha, file: inventory.manifest[sha]
          });
          if( inventory.manifest[sha] ) {
            delete inventory.manifest[sha];
          }
        }
      }

      if( vint !== toVersionInt ) {
        versionsToRemove.push({int: vint, str: version});
        delete inventory.versions[version];
      }
    }

    inventory.head = toVersion;
    for( let item of filesToMove ) {
      for( let i = 0; i < item.file.length; i++ ) {
        inventory.manifest[item.sha][i] = item.file[i].to;
      }
    }

    this.log('\nRemoving versions:');
    for( let item of versionsToRemove ) {
      this.log(' - ', item.str);
    }

    this.log('\nMoving files:');
    for( let item of filesToMove ) {
      this.log(' - ', item.sha);
      for( let file of item.file ) {
        this.log('    |- '+file.from+' -> '+file.to);
      }
    }

    this.log('\nRemoving files:');
    for( let item of filesToRemove ) {
      this.log(' - ', item.sha);
      for( let file of item.file ) {
        this.log('    |- '+file);
      }
    }

    let newInventoryStr = JSON.stringify(inventory);
    let newInventorySha = this.getHash({data: newInventoryStr});

    this.log('\nWriting inventory:');
    this.log(inventoryFilePath);
    this.log(inventoryVersionFilePath);
    this.log(JSON.stringify(inventory, ' ', 2));

    return {
      fcrepoPath,
      inventoryFilePath,
      inventoryVersionFilePath,
      version : {
        from: currentVersion,
        to: toVersion
      },     
      inventory,
      newInventorySha,
      filesToMove,
      filesToRemove,
      versionsToRemove
    }

  }

}

let test = new OcflSquash();
// test.squash('/item/ark:/87293/d38j6q/700-N-a-28-4.tif', 'v1');
test.squash('/item/ark:/87293/d38j6q', 'v1');
