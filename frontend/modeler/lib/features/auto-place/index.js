import AutoPlaceModule from 'diagram-js/lib/features/auto-place';

import DCRAutoPlace from './DCRAutoPlace';

export default {
  __depends__: [ AutoPlaceModule ],
  __init__: [ 'odAutoPlace' ],
  odAutoPlace: [ 'type', DCRAutoPlace ]
};