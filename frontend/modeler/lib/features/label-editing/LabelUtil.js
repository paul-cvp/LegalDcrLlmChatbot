import { isAny } from '../modeling/util/ModelingUtil';
import { is } from '../../util/ModelUtil';

function getLabelAttr(semantic) {
  if (semantic.labelAttribute) {
    return semantic.labelAttribute;
  }
  if (isAny(semantic, [ 'dcr:TextBox', 'dcr:Relation' ])) {
    return 'name';
  } else if (is(semantic, 'dcr:Event')) {
    return 'role';
  }
}

export function getLabel(element) {
  var semantic = element.businessObject;
  var attr = getLabelAttr(semantic);

  if (attr) {
    return semantic[attr] || '';
  }
}


export function setLabel(element, text) {
  var semantic = element.businessObject,
      attr = getLabelAttr(semantic);

  if (attr) {
    semantic[attr] = text;
  }

  return element;
}