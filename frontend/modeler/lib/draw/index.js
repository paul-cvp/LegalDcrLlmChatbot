import DCRRenderer from './DCRRenderer';
import TextRenderer from './TextRenderer';
import PathMap from './PathMap';

export default {
  __init__: [ 'odRenderer' ],
  odRenderer: [ 'type', DCRRenderer ],
  textRenderer: [ 'type', TextRenderer ],
  pathMap: [ 'type', PathMap ],
};
