import translate from 'diagram-js/lib/i18n/translate';

import DCROrderingProvider from './DCROrderingProvider';

export default {
  __depends__: [
    translate
  ],
  __init__: [ 'odOrderingProvider' ],
  odOrderingProvider: [ 'type', DCROrderingProvider ]
};