
import {
  assign
} from 'min-dash';

import Moddle from './Moddle';

import DCRDescriptors from './resources/dcr.json';
import DiDescriptors from './resources/dcrDi.json';
import DcDescriptors from './resources/dc.json';

var packages = {
  dcr: DCRDescriptors,
  dcrDi: DiDescriptors,
  dc: DcDescriptors,
};

export default function(additionalPackages, options) {
  var pks = assign({}, packages, additionalPackages);

  return new Moddle(pks, options);
}
