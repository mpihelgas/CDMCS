/******************************************************************************/
/*

! under construction

check tuple against suricata alerts stored in elasticsearch by evebox

see https://github.com/ccdcoe/CDMCS/blob/master/Suricata/evebox/esimport.md


 */
'use strict';

var wiseSource     = require('./wiseSource.js')
  , util           = require('util')
  , request        = require('request')
  ;

var source;

//////////////////////////////////////////////////////////////////////////////////
function SuricataSource (api, section) {
  var self = this;
  SuricataSource.super_.call(this, api, section);
  this.evBox = this.api.getConfig("suricata", "evBox");
  if (this.evBox === undefined) {
    console.log(this.section, "- No evebox host defined");
    return;
  }
  this.tags = "";
  // see https://github.com/jasonish/evebox/blob/dbfa3ce1348fc8186bf36fbfda85a7966949e833/webapp/src/app/elasticsearch.service.ts#L288
  var mustHaveTags = this.api.getConfig("suricata", "mustHaveTags");
  if (!this.mustHaveTags === undefined) {
    mustHaveTags.split(";").forEach(function(tag){
      this.tags += tag.trim() + ","
    });
  }
  var mustNotHaveTags = this.api.getConfig("suricata", "mustNotHaveTags");
  if (!mustNotHaveTags === undefined) {
    mustNotHaveTags.split(";").forEach(function(tag){
      this.tags += "-" +tag.trim() + ","
    });
  }
  // test evebox connection
  var options = {
    url: this.evBox+"/api/1/version",
    method: 'GET',
    json: true
  };
  var req = request(options, function(err, im, results) {
    if (err || im.statusCode != 200 || results === undefined) {
      console.log(self.section, "- Error for request:\n", options, "\n", im, "\nresults:\n", results);
      return;
    }
    console.dir(results)
    // TODO move it to https://github.com/aol/moloch/blob/master/capture/plugins/wiseService/wiseSource.js#L39
    self.excludeTuples = [];
    self.api.addSource("suricata", self);
  }).on('error', function (err) {
    console.log(self.section, "- ERROR",err);
    return;
  });

}

util.inherits(SuricataSource, wiseSource);

//////////////////////////////////////////////////////////////////////////////////
SuricataSource.prototype.getTuple = function(tuple, cb) {

  // [ '1490640063', 'tcp', '10.0.2.2', '57000', '10.0.2.15', '22' ]
  // wait for node upgrade ...
  // var [ timestamp, protos, src_ip, src_port, dest_ip, dest_port ] = tuple.split(";");
  var bites = tuple.split(";");
  var timestamp = bites[0];
  var protos = bites[1].split(",");
  var src_ip = bites[2];
  var src_port = bites[3];
  var dest_ip = bites[4];
  var dest_port = bites[5];

  // build evebox query
  // see :
  // * https://github.com/jasonish/evebox/blob/master/elasticsearch/alertqueryservice.go
  // * https://github.com/jasonish/evebox/blob/59472e3dd9449b95bf78dc08e2b7f1a88834ed70/core/eventservice.go#L46

  var timeRange = Math.floor(Date.now()/1000) - timestamp;

  var queryString = "src_ip:%22"+ src_ip +"%22%20AND%20" +
                    "src_port:%22"+ src_port +"%22%20AND%20" +
                    "dest_ip:%22"+ dest_ip +"%22%20AND%20" +
                    "dest_port:%22"+ dest_port +"%22"

  var url = this.evBox+"/api/1/alerts?tags=" +  this.tags + "&timeRange=" + timeRange + "s&queryString=" + queryString
  if (this.api.debug > 2) {
    console.log(url)
  }
  var options = {
    url: url,
    method: 'GET',
    json: true
  };
  var self = this;
  var req = request(options, function(err, im, results) {
    if (err || im.statusCode != 200 || results === undefined) {
      if (self.api.debug > 2) {
      console.log(self.section, "- Error for request:\n", options, "\n", im, "\nresults:\n", results);
      }
      return cb(undefined, undefined);
    }
    if (self.api.debug > 2) {
      console.dir(results['alerts'])
    }
    if (results['alerts'].length == 0) {
       return cb(undefined, undefined);
    }
  }).on('error', function (err) {
    console.log(self.section, "- ERROR",err);
    return cb(undefined, undefined);
  });

  /*
  response
    {
  "alerts": [
    {
      "count": 4,
      "event": {
        "_id": "15e522cd-1327-11e7-999b-aafd891908d5",
        "_index": "evebox-2017.03.27",
        "_score": null,
        "_source": {
          "@timestamp": "2017-03-27T19:53:44.67Z",
          "alert": {
            "action": "allowed",
            "category": "Misc activity",
            "gid": 1,
            "rev": 8,
            "severity": 3,
            "signature": "ET POLICY SSH session in progress on Expected Port",
            "signature_id": 2001978
          },
          "dest_ip": "50.116.50.93",
          "dest_port": 22,
          "event_type": "alert",
          "flow_id": 619537989396051,
          "geoip": {
            "continent_code": "EU",
            "coordinates": [
              -9.1333,
              38.7167
            ],
            "country_code2": "PT",
            "country_name": "Portugal",
            "ip": "85.241.98.168",
            "latitude": 38.7167,
            "longitude": -9.1333,
            "region_code": "11",
            "region_name": "Lisbon"
          },
          "in_iface": "eth0",
          "packet": "8jyRFtGHhHisV6rBCABFAAHASEBAAHcGnI1V8WKoMnQyXaGmABZjaCyPe2cch1AYAQHAgQAAAAABlAsUesAO5NT7sxxpOeIdfyau7gAAAFlkaWZmaWUtaGVsbG1hbi1ncm91cDEtc2hhMSxkaWZmaWUtaGVsbG1hbi1ncm91cDE0LXNoYTEsZGlmZmllLWhlbGxtYW4tZ3JvdXAtZXhjaGFuZ2Utc2hhMQAAAA9zc2gtcnNhLHNzaC1kc3MAAAA0YWVzMTI4LWN0cixhZXMxMjgtY2JjLDNkZXMtY3RyLDNkZXMtY2JjLGJsb3dmaXNoLWNiYwAAADRhZXMxMjgtY3RyLGFlczEyOC1jYmMsM2Rlcy1jdHIsM2Rlcy1jYmMsYmxvd2Zpc2gtY2JjAAAAOWhtYWMtbWQ1LGhtYWMtc2hhMSxobWFjLXNoYTItMjU2LGhtYWMtc2hhMS05NixobWFjLW1kNS05NgAAADlobWFjLW1kNSxobWFjLXNoYTEsaG1hYy1zaGEyLTI1NixobWFjLXNoYTEtOTYsaG1hYy1tZDUtOTYAAAAEbm9uZQAAAARub25lAAAAAAAAAAAAAAAAAG566pO4E/rJ0xou",
          "packet_info": {
            "linktype": 1
          },
          "payload": "AAABlAsUesAO5NT7sxxpOeIdfyau7gAAAFlkaWZmaWUtaGVsbG1hbi1ncm91cDEtc2hhMSxkaWZmaWUtaGVsbG1hbi1ncm91cDE0LXNoYTEsZGlmZmllLWhlbGxtYW4tZ3JvdXAtZXhjaGFuZ2Utc2hhMQAAAA9zc2gtcnNhLHNzaC1kc3MAAAA0YWVzMTI4LWN0cixhZXMxMjgtY2JjLDNkZXMtY3RyLDNkZXMtY2JjLGJsb3dmaXNoLWNiYwAAADRhZXMxMjgtY3RyLGFlczEyOC1jYmMsM2Rlcy1jdHIsM2Rlcy1jYmMsYmxvd2Zpc2gtY2JjAAAAOWhtYWMtbWQ1LGhtYWMtc2hhMSxobWFjLXNoYTItMjU2LGhtYWMtc2hhMS05NixobWFjLW1kNS05NgAAADlobWFjLW1kNSxobWFjLXNoYTEsaG1hYy1zaGEyLTI1NixobWFjLXNoYTEtOTYsaG1hYy1tZDUtOTYAAAAEbm9uZQAAAARub25lAAAAAAAAAAAAAAAAAG566pO4E/rJ0xou",
          "payload_printable": "......z.......i9...&.....Ydiffie-hellman-group1-sha1,diffie-hellman-group14-sha1,diffie-hellman-group-exchange-sha1....ssh-rsa,ssh-dss...4aes128-ctr,aes128-cbc,3des-ctr,3des-cbc,blowfish-cbc...4aes128-ctr,aes128-cbc,3des-ctr,3des-cbc,blowfish-cbc...9hmac-md5,hmac-sha1,hmac-sha2-256,hmac-sha1-96,hmac-md5-96...9hmac-md5,hmac-sha1,hmac-sha2-256,hmac-sha1-96,hmac-md5-96....none....none.............nz.........",
          "proto": "TCP",
          "src_ip": "85.241.98.168",
          "src_port": 41382,
          "ssh": {
            "client": {
              "proto_version": "2.0",
              "software_version": "JSCH-0.1.51"
            },
            "server": {
              "proto_version": "2.0",
              "software_version": "OpenSSH_6.6.1"
            }
          },
          "stream": 0,
          "tags": [],
          "timestamp": "2017-03-27T19:53:44.670301+0000"
        },
        "_type": "log",
        "sort": [
          1490644424670
        ]
      },
      "maxTs": "2017-03-27T19:53:44.670301+0000",
      "minTs": "2017-03-27T19:11:32.814443+0000",
      "escalatedCount": 0
    }
  ]
}
  */



};

//////////////////////////////////////////////////////////////////////////////////
exports.initSource = function(api) {
  var source = new SuricataSource(api, "suricata");
};
//////////////////////////////////////////////////////////////////////////////////
