import translate from 'diagram-js/lib/i18n/translate';

import DCRImporter from './DCRImporter';

export default {
  __depends__: [
    translate
  ],
  DCRImporter: [ 'type', DCRImporter ]
};