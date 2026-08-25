import { is, getBusinessObject } from '../../util/ModelUtil';
import { validateGuardSyntax } from 'dcr-engine';

var VALID_DURATION = /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i;

export default function GuardsAndTimeProvider(
  eventBus, canvas, modeling, contextPad, elementRegistry, moddle
) {
  this._canvas = canvas;
  this._modeling = modeling;
  this._elementRegistry = elementRegistry;
  this._moddle = moddle;
  this._toolCalls = null;
  this._activityQuestionGenerator = null;
  this._panel = null;
  this._backdrop = null;

  contextPad.registerProvider(this);

  var self = this;

  eventBus.on([
    'canvas.viewbox.changed',
    'element.remove',
    'diagram.destroy',
  ], function() {
    self._closePanel();
  });
}

GuardsAndTimeProvider.$inject = [
  'eventBus', 'canvas', 'modeling', 'contextPad', 'elementRegistry', 'moddle'
];

// ── Context pad entries ────────────────────────────────────────────────────

GuardsAndTimeProvider.prototype.getContextPadEntries = function(element) {
  var self = this;
  var actions = {};

  if (is(element, 'dcr:Relation')) {
    actions['edit-relation-constraints'] = {
      group: 'annotate',
      className: 'bpmn-icon-script-task',
      title: 'Edit relation constraints',
      action: {
        click: function(evt, el) {
          evt.stopPropagation();
          self.openRelationPanel(el);
        }
      }
    };
  }

  if (is(element, 'dcr:Event') || is(element, 'dcr:SubProcess')) {
    actions['edit-metadata'] = {
      group: 'annotate',
      className: 'bpmn-icon-text-annotation',
      title: 'Edit metadata',
      action: {
        click: function(evt, el) {
          evt.stopPropagation();
          self.openMetadataPanel(el);
        }
      }
    };
  }

  return actions;
};

GuardsAndTimeProvider.prototype.setToolCalls = function(toolCalls) {
  this._toolCalls = Array.isArray(toolCalls) ? toolCalls.slice() : [];
};

GuardsAndTimeProvider.prototype.setActivityQuestionGenerator = function(generator) {
  this._activityQuestionGenerator = typeof generator === 'function' ? generator : null;
};

// ── Panel helpers ──────────────────────────────────────────────────────────

GuardsAndTimeProvider.prototype._closePanel = function() {
  if (this._backdrop && this._backdrop.parentNode) {
    this._backdrop.parentNode.removeChild(this._backdrop);
  }
  if (this._panel && this._panel.parentNode) {
    this._panel.parentNode.removeChild(this._panel);
  }
  if (this._tooltip && this._tooltip.parentNode) {
    this._tooltip.parentNode.removeChild(this._tooltip);
  }
  this._backdrop = null;
  this._panel = null;
  this._tooltip = null;
};

GuardsAndTimeProvider.prototype._makePanel = function() {
  this._closePanel();

  var self = this;

  // Transparent backdrop — clicking outside closes the panel
  var backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;';
  backdrop.addEventListener('click', function() { self._closePanel(); });
  document.body.appendChild(backdrop);
  this._backdrop = backdrop;

  var panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'top:50%',
    'left:50%',
    'transform:translate(-50%,-50%)',
    'background:white',
    'border:1px solid #ccc',
    'border-radius:8px',
    'padding:18px',
    'box-shadow:0 8px 28px rgba(0,0,0,0.25)',
    'z-index:10000',
    'min-width:310px',
    'font-family:sans-serif',
    'font-size:13px',
    'color:#333',
  ].join(';');
  // Stop clicks on the panel from reaching the backdrop
  panel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  panel.addEventListener('click',     function(e) { e.stopPropagation(); });
  document.body.appendChild(panel);
  this._panel = panel;

  var tooltip = document.createElement('div');
  tooltip.style.cssText = [
    'position:fixed',
    'background:#333',
    'color:white',
    'font-size:11px',
    'padding:5px 8px',
    'border-radius:4px',
    'pointer-events:none',
    'z-index:10001',
    'max-width:240px',
    'line-height:1.5',
    'display:none',
  ].join(';');
  document.body.appendChild(tooltip);
  this._tooltip = tooltip;

  return panel;
};

// ── Relation panel (time constraint + guard) ───────────────────────────────

GuardsAndTimeProvider.prototype.openRelationPanel = function(element, pendingType) {
  var self = this;
  var bo = getBusinessObject(element);
  var relType = pendingType || bo.get('type');
  var hasTime = relType === 'condition' || relType === 'response';
  var hasValue = relType === 'setValue';
  var target = element.target;
  var targetBo = target && getBusinessObject(target);
  var targetEventData = targetBo && targetBo.get('eventData');
  var timeLabel = relType === 'condition' ? 'Delay' : 'Deadline';

  var titleText = 'Relation Constraints';

  var panel = this._makePanel();

  panel.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:14px">' + titleText + '</div>' +
    (hasTime
      ? '<div style="margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
            '<label style="font-weight:600">' + timeLabel + '</label>' +
            '<span id="_info_time_btn" data-tooltip="ISO 8601 duration — e.g. P3D (3 days), PT2H (2 hours), PT30M (30 min). Leave blank to clear." style="cursor:default;color:#aaa;font-size:13px;line-height:1;user-select:none">ⓘ</span>' +
          '</div>' +
          '<input id="_ann_time" type="text" value="' + _esc(bo.get('time') || '') + '"' +
            ' placeholder="e.g. P3D, PT2H30M"' +
            ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
        '</div>'
      : '') +
    (hasValue
      ? '<div style="margin-bottom:12px">' +
          '<label style="font-weight:600;display:block;margin-bottom:4px">Value expression</label>' +
          '<input id="_ann_value" type="text" value="' + _esc(bo.get('value') || '') + '"' +
            ' placeholder="e.g. amount + 1"' +
            ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
        '</div>'
      : '') +
    (hasValue && !targetEventData
      ? '<div style="margin-bottom:12px">' +
          '<label style="font-weight:600;display:block;margin-bottom:4px">Target variable type</label>' +
          '<select id="_ann_target_type" style="width:100%;padding:6px 4px;border:1px solid #ccc;border-radius:4px;font-size:13px">' +
            '<option value="">Choose type</option>' +
            '<option value="String">String</option>' +
            '<option value="Int">Int</option>' +
            '<option value="Bool">Bool</option>' +
          '</select>' +
          '<div style="font-size:11px;color:#666;margin-top:4px">Creates variable “' + _esc(targetBo && targetBo.id) + '”.</div>' +
        '</div>'
      : '') +
    '<div style="margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<label style="font-weight:600">Guard</label>' +
        '<span id="_info_guard_btn" data-tooltip="FEEL expression — e.g. amount > 0, status = &quot;ok&quot;. Leave blank to clear." style="cursor:default;color:#aaa;font-size:13px;line-height:1;user-select:none">ⓘ</span>' +
      '</div>' +
      '<input id="_ann_guard" type="text" value="' + _esc(bo.get('guard') || '') + '"' +
        ' placeholder="e.g. amount > 0"' +
        ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
    '</div>' +
    '<div id="_ann_err" style="color:#dc3545;font-size:11px;min-height:16px;margin-bottom:6px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="_ann_cancel" style="padding:6px 14px;border:1px solid #ccc;border-radius:4px;cursor:pointer;background:white">Cancel</button>' +
      '<button id="_ann_save" style="padding:6px 14px;border:none;border-radius:4px;cursor:pointer;background:#28a745;color:white;font-weight:bold">Save</button>' +
    '</div>';

  // Wire up ⓘ hover tooltips
  var tooltip = this._tooltip;
  ['time', 'guard'].forEach(function(key) {
    var btn = panel.querySelector('#_info_' + key + '_btn');
    if (!btn) return;
    btn.addEventListener('mouseenter', function() {
      tooltip.textContent = btn.dataset.tooltip;
      tooltip.style.display = 'block';
      var rect = btn.getBoundingClientRect();
      tooltip.style.left = Math.round(rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
      tooltip.style.top  = Math.round(rect.bottom + 6) + 'px';
    });
    btn.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
    });
  });

  setTimeout(function() {
    var first = panel.querySelector('#_ann_value') || panel.querySelector('#_ann_time') || panel.querySelector('#_ann_guard');
    if (first) first.focus();
  }, 30);

  var errEl = panel.querySelector('#_ann_err');

  panel.querySelector('#_ann_cancel').addEventListener('click', function() {
    self._closePanel();
  });

  function save() {
    errEl.textContent = '';
    var props = {};

    if (hasTime) {
      var timeVal = (panel.querySelector('#_ann_time').value || '').trim();
      if (timeVal && (!VALID_DURATION.test(timeVal) || timeVal === 'P' || timeVal === 'PT')) {
        errEl.textContent = 'Invalid ISO 8601 duration — examples: P3D, PT2H, PT30M, P1DT12H';
        return;
      }
      props.time = timeVal || undefined;
    }

    if (hasValue) {
      if (!target || target.type !== 'dcr:Event') {
        errEl.textContent = 'Set-value relations must target an event.';
        return;
      }
      var valueVal = (panel.querySelector('#_ann_value').value || '').trim();
      if (!valueVal) {
        errEl.textContent = 'Set-value relations require a value expression.';
        return;
      }
      var valueErr = self._validateValue(valueVal, targetEventData ? null : targetBo.id);
      if (valueErr) { errEl.textContent = valueErr; return; }
      if (!targetEventData) {
        var targetType = panel.querySelector('#_ann_target_type').value;
        if (!targetType) {
          errEl.textContent = 'Choose a type for the target variable.';
          return;
        }
        if (self._isVariableNameTakenElsewhere(targetBo.id, target)) {
          errEl.textContent = 'Variable "' + targetBo.id + '" is already declared on another activity.';
          return;
        }
        targetEventData = self._moddle.create('dcr:EventData', {
          name: targetBo.id,
          type: targetType
        });
      }
      props.value = valueVal;
      props.type = 'setValue';
      props.time = undefined;
    }

    var guardVal = (panel.querySelector('#_ann_guard').value || '').trim();
    var guardErr = self._validateGuard(
      guardVal,
      hasValue && !targetBo.get('eventData') ? targetBo.id : null
    );
    if (guardErr) { errEl.textContent = guardErr; return; }
    props.guard = guardVal || undefined;

    if (targetEventData && targetBo.get('eventData') !== targetEventData) {
      self._modeling.updateProperties(target, { eventData: targetEventData });
    }
    self._modeling.updateProperties(element, props);
    self._closePanel();
  }

  panel.querySelector('#_ann_save').addEventListener('click', save);

  panel.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Escape') self._closePanel();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') save();
  });
};

// ── Activity variable helpers ─────────────────────────────────────────────

function eventVariableState(eventData) {
  return eventData ? {
    name: String(eventData.name || ''),
    type: String(eventData.type || 'String'),
    default: eventData['default'] !== undefined ? String(eventData['default']) : ''
  } : null;
}

function eventVariableDefaultHtml(variable) {
  if (variable.type === 'Int') {
    return (
      '<div style="display:flex;align-items:stretch;border:1px solid #ccc;border-radius:4px;overflow:hidden;margin-top:8px">' +
        '<button id="_metadata_var_dec" type="button" style="padding:4px 10px;border:none;border-right:1px solid #ccc;cursor:pointer;background:#f5f5f5;font-size:15px;line-height:1">&#x2212;</button>' +
        '<input id="_metadata_var_default" type="number" value="' + _esc(variable.default || '') + '" placeholder="default"' +
          ' style="flex:1;min-width:0;padding:5px 4px;border:none;text-align:center;font-size:13px;-moz-appearance:textfield"/>' +
        '<button id="_metadata_var_inc" type="button" style="padding:4px 10px;border:none;border-left:1px solid #ccc;cursor:pointer;background:#f5f5f5;font-size:15px;line-height:1">&#x2b;</button>' +
      '</div>'
    );
  }
  if (variable.type === 'Bool') {
    return (
      '<select id="_metadata_var_default" style="width:100%;margin-top:8px;padding:5px 4px;border:1px solid #ccc;border-radius:4px;font-size:13px">' +
        '<option value=""' + (!variable.default ? ' selected' : '') + '></option>' +
        '<option value="true"' + (variable.default === 'true' ? ' selected' : '') + '>true</option>' +
        '<option value="false"' + (variable.default === 'false' ? ' selected' : '') + '>false</option>' +
      '</select>'
    );
  }
  return (
    '<input id="_metadata_var_default" type="text" value="' + _esc(variable.default || '') + '"' +
      ' placeholder="default (optional)"' +
      ' style="width:100%;box-sizing:border-box;margin-top:8px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>'
  );
}

function defaultToolVariableName(provider, element, variable) {
  var rawName = variable && variable.name.trim() || getBusinessObject(element).id || 'result';
  var baseName = rawName.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(baseName)) baseName = '_' + baseName;
  var name = baseName || 'result';
  var suffix = 2;
  while (provider._isVariableNameTakenElsewhere(name, element)) {
    name = baseName + '_' + suffix++;
  }
  return name;
}

// ── Activity metadata panel ───────────────────────────────────────────────

function computationTokenType(token) {
  if (token && typeof token === 'object' && Array.isArray(token.tuple)) {
    return token.tuple.length === 4 ? 'tuple4' : 'tuple2';
  }
  return typeof token === 'boolean' ? 'boolean' :
    typeof token === 'number' ? 'number' : 'string';
}

function validateComputation(computation) {
  if (!Array.isArray(computation)) return 'Computation must be a JSON list.';
  for (var token of computation) {
    if (token && typeof token === 'object' && !Array.isArray(token)) {
      var keys = Object.keys(token);
      if (keys.length !== 1 || keys[0] !== 'tuple' ||
          !Array.isArray(token.tuple) || ![2, 4].includes(token.tuple.length) ||
          !token.tuple.every(function(part) { return typeof part === 'string'; })) {
        return 'Tuple tokens must contain exactly 2 or 4 string parts.';
      }
    } else if (!['string', 'boolean', 'number'].includes(typeof token)) {
      return 'Computation tokens must be strings, numbers, booleans, or tuples.';
    } else if (typeof token === 'number' && !Number.isFinite(token)) {
      return 'Computation numbers must be finite.';
    }
  }
  return null;
}

function parseComputation(value) {
  if (!value) return { tokens: [], error: null };
  try {
    var tokens = JSON.parse(value);
    var error = validateComputation(tokens);
    return { tokens: error ? [] : tokens, error: error };
  } catch (_) {
    return { tokens: [], error: 'Stored computation is not valid JSON.' };
  }
}

function hasToolInvocation(computation) {
  return computation.some(function(token) {
    return token && Array.isArray(token.tuple) &&
      token.tuple[0] === 'source' && token.tuple[1] === 'tool';
  });
}

function ComputationEditor(container, computation, error, onChange) {
  this.container = container;
  this.computation = computation;
  this.error = error;
  this.onChange = onChange;
  this.render();
}

ComputationEditor.prototype._changed = function() {
  this.error = null;
  this.onChange();
};

ComputationEditor.prototype.add = function() {
  this.computation.push('');
  this._changed();
  this.render();
};

ComputationEditor.prototype.ensureToolInvocation = function() {
  if (hasToolInvocation(this.computation)) return;
  this.computation.push({ tuple: ['source', 'tool'] });
  this._changed();
  this.render();
};

ComputationEditor.prototype.render = function() {
  var self = this;
  this.container.innerHTML = '';
  if (!this.computation.length) {
    this.container.innerHTML = '<div style="font-size:11px;color:#777">No computation tokens.</div>';
  }
  this.computation.forEach(function(token, index) {
    self.container.appendChild(self._row(token, index));
  });
};

ComputationEditor.prototype._row = function(token, index) {
  var self = this;
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:5px;align-items:center';
  var type = document.createElement('select');
  type.className = '_metadata_token_type';
  type.style.cssText = 'width:115px;padding:5px;border:1px solid #ccc;border-radius:4px;background:white';
  type.innerHTML = '<option value="string">String</option><option value="number">Number</option>' +
    '<option value="boolean">Boolean</option><option value="tuple2">2-part tuple</option>' +
    '<option value="tuple4">4-part tuple</option>';
  type.value = computationTokenType(token);
  type.addEventListener('change', function() {
    self.computation[index] = type.value === 'number' ? 0 :
      type.value === 'boolean' ? false :
      type.value === 'tuple2' ? { tuple: ['', ''] } :
      type.value === 'tuple4' ? { tuple: ['', '', '', ''] } : '';
    self._changed();
    self.render();
  });
  row.appendChild(type);
  this._appendValueInputs(row, token, index, type.value);
  this._appendActions(row, index);
  return row;
};

ComputationEditor.prototype._appendValueInputs = function(row, token, index, type) {
  var self = this;
  if (type === 'boolean') {
    var booleanInput = document.createElement('select');
    booleanInput.className = '_metadata_token_value';
    booleanInput.innerHTML = '<option value="true">true</option><option value="false">false</option>';
    booleanInput.value = String(token);
    booleanInput.addEventListener('change', function() {
      self.computation[index] = booleanInput.value === 'true';
      self._changed();
    });
    row.appendChild(booleanInput);
    return;
  }
  if (type === 'tuple2' || type === 'tuple4') {
    token.tuple.forEach(function(part, partIndex) {
      var partInput = document.createElement('input');
      partInput.className = '_metadata_token_value';
      partInput.type = 'text';
      partInput.value = part;
      partInput.placeholder = 'part ' + (partIndex + 1);
      partInput.style.cssText = 'min-width:0;flex:1;padding:5px;border:1px solid #ccc;border-radius:4px';
      partInput.addEventListener('input', function() {
        token.tuple[partIndex] = partInput.value;
        self._changed();
      });
      row.appendChild(partInput);
    });
    return;
  }
  var valueInput = document.createElement('input');
  valueInput.className = '_metadata_token_value';
  valueInput.type = 'text';
  valueInput.value = String(token);
  valueInput.placeholder = type;
  valueInput.style.cssText = 'min-width:0;flex:1;padding:5px;border:1px solid #ccc;border-radius:4px';
  valueInput.addEventListener('input', function() {
    self.computation[index] = type === 'number' ? Number(valueInput.value) : valueInput.value;
    self._changed();
  });
  row.appendChild(valueInput);
};

ComputationEditor.prototype._appendActions = function(row, index) {
  var self = this;
  [['↑', -1], ['↓', 1]].forEach(function(move) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = move[0];
    button.disabled = index + move[1] < 0 || index + move[1] >= self.computation.length;
    button.addEventListener('click', function() {
      var next = index + move[1];
      [self.computation[index], self.computation[next]] =
        [self.computation[next], self.computation[index]];
      self._changed();
      self.render();
    });
    row.appendChild(button);
  });
  var remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '×';
  remove.addEventListener('click', function() {
    self.computation.splice(index, 1);
    self._changed();
    self.render();
  });
  row.appendChild(remove);
};

GuardsAndTimeProvider.prototype.openMetadataPanel = function(element) {
  var self = this;
  var bo = getBusinessObject(element);
  var isEvent = is(element, 'dcr:Event');
  var supportsDataVariable = isEvent || is(element, 'dcr:SubProcess');
  var editVariable = supportsDataVariable ? eventVariableState(bo.get('eventData')) : null;
  var variableChanged = false;
  var panel = this._makePanel();
  var originalComputation = bo.get('computation');
  var parsed = parseComputation(originalComputation);
  var computationChanged = false;
  var originalTool = bo.get('toolCall');
  var originalTrusted = bo.get('trusted');
  var toolChanged = false;
  var toolCalls = this._toolCalls;
  var questionButton = is(element, 'dcr:Event') && this._activityQuestionGenerator ?
    '<button id="_metadata_generate_question" type="button"' +
      ' style="padding:4px 9px;border:1px solid #aaa;border-radius:4px;background:white;cursor:pointer">Generate question</button>' : '';
  panel.style.minWidth = '620px';
  panel.style.maxHeight = '85vh';
  panel.style.overflowY = 'auto';

  var toolOptions = '<option value="">None</option>';
  (toolCalls || []).forEach(function(tool) {
    toolOptions += '<option value="' + _esc(tool.value) + '">' +
      _esc(tool.label) + '</option>';
  });
  if (originalTool && !(toolCalls || []).some(function(tool) {
    return tool.value === originalTool;
  })) {
    toolOptions += '<option value="' + _esc(originalTool) + '">' +
      _esc(originalTool) + ' (unavailable)</option>';
  }

  panel.innerHTML =
    '<div style="font-weight:700;font-size:14px;margin-bottom:14px">' +
      'Metadata &mdash; ' + _esc(bo.get('label') || bo.id) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
      '<div>' +
        '<label style="font-weight:600;display:block;margin-bottom:4px">Label</label>' +
        '<input id="_metadata_label" type="text" value="' + _esc(bo.get('label') || '') + '"' +
          ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
      '</div>' +
      '<div>' +
        '<label style="font-weight:600;display:block;margin-bottom:4px">Role / Actor</label>' +
        '<input id="_metadata_role" type="text" value="' + _esc(bo.get('role') || '') + '"' +
          ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
        '<label style="font-weight:600">Description</label>' + questionButton +
      '</div>' +
      '<textarea id="_metadata_description" rows="4" placeholder="description (optional)"' +
        ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:13px sans-serif;resize:vertical">' +
        _esc(bo.get('description') || '') +
      '</textarea>' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<label style="font-weight:600;display:block;margin-bottom:4px">Priority</label>' +
      '<input id="_metadata_priority" type="text" inputmode="decimal" placeholder="priority (optional)" value="' +
        _esc(bo.get('priority') === undefined ? '' : String(bo.get('priority'))) + '"' +
        ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font:13px sans-serif"/>' +
    '</div>' +
    (supportsDataVariable
      ? '<div style="margin-bottom:12px">' +
          '<label style="font-weight:600;display:block;margin-bottom:4px">Data variable</label>' +
          '<div id="_metadata_variable"></div>' +
        '</div>'
      : '') +
    '<div style="margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<label style="font-weight:600">Tool call</label>' +
        '<label style="display:flex;align-items:center;gap:5px">' +
          '<input id="_metadata_trusted" type="checkbox"' + (originalTrusted !== false ? ' checked' : '') + '/>' +
          '<span>Trusted</span>' +
        '</label>' +
      '</div>' +
      '<select id="_metadata_tool"' + (toolCalls === null ? ' disabled' : '') +
        ' style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:4px;background:white">' +
        toolOptions +
      '</select>' +
      (toolCalls === null ? '<div style="font-size:11px;color:#777;margin-top:3px">Tool registry unavailable; the stored value will be preserved.</div>' : '') +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">' +
        '<label style="font-weight:600">Computation</label>' +
        '<button id="_metadata_add_token" type="button" style="padding:4px 9px;border:1px solid #aaa;border-radius:4px;background:white;cursor:pointer">Add token</button>' +
      '</div>' +
      '<div id="_metadata_computation_rows" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto"></div>' +
    '</div>' +
    '<div id="_metadata_err" style="color:#dc3545;font-size:11px;min-height:16px;margin-bottom:6px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button id="_metadata_cancel" style="padding:6px 14px;border:1px solid #ccc;border-radius:4px;cursor:pointer;background:white">Cancel</button>' +
      '<button id="_metadata_save" style="padding:6px 14px;border:none;border-radius:4px;cursor:pointer;background:#28a745;color:white;font-weight:bold">Save</button>' +
    '</div>';

  var label = panel.querySelector('#_metadata_label');
  var role = panel.querySelector('#_metadata_role');
  var description = panel.querySelector('#_metadata_description');
  var priority = panel.querySelector('#_metadata_priority');
  var tool = panel.querySelector('#_metadata_tool');
  var trusted = panel.querySelector('#_metadata_trusted');
  var error = panel.querySelector('#_metadata_err');
  tool.value = originalTool || '';

  function updateTrustedAvailability() {
    trusted.disabled = !tool.value;
  }
  updateTrustedAvailability();

  function renderVariableEditor() {
    var container = panel.querySelector('#_metadata_variable');
    if (!container) return;
    if (tool.value) {
      container.innerHTML =
        '<div style="padding:8px;border:1px solid #d5d9df;border-radius:4px;background:#f7f8fa;color:#555">' +
          'Tool result variable <strong>' +
            _esc(defaultToolVariableName(self, element, editVariable)) +
          '</strong> is provided automatically as String and cannot take user input.' +
        '</div>';
      return;
    }
    container.innerHTML = editVariable
      ? '<div>' +
          '<label style="display:block;margin-bottom:4px">Name</label>' +
          '<input id="_metadata_var_name" type="text" value="' + _esc(editVariable.name) + '" placeholder="variable name"' +
            ' style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px"/>' +
          '<label style="display:block;margin-top:8px;margin-bottom:4px">Type</label>' +
          '<select id="_metadata_var_type" style="width:100%;padding:5px 4px;border:1px solid #ccc;border-radius:4px;font-size:13px">' +
            '<option value="String"' + (editVariable.type === 'String' ? ' selected' : '') + '>String</option>' +
            '<option value="Int"' + (editVariable.type === 'Int' ? ' selected' : '') + '>Int</option>' +
            '<option value="Bool"' + (editVariable.type === 'Bool' ? ' selected' : '') + '>Bool</option>' +
          '</select>' +
          '<label style="display:block;margin-top:8px;margin-bottom:4px">Default</label>' +
          eventVariableDefaultHtml(editVariable) +
          '<button id="_metadata_var_clear" type="button" style="margin-top:10px;padding:4px 10px;border:1px solid #dc3545;border-radius:4px;cursor:pointer;background:white;color:#dc3545;font-size:12px">Remove variable</button>' +
        '</div>'
      : '<button id="_metadata_var_add" type="button" style="padding:4px 12px;border:1px solid #2196F3;border-radius:4px;cursor:pointer;background:white;color:#2196F3">+ Add variable</button>';

    if (!editVariable) {
      container.querySelector('#_metadata_var_add').addEventListener('click', function() {
        editVariable = { name: '', type: 'String', default: '' };
        variableChanged = true;
        renderVariableEditor();
        panel.querySelector('#_metadata_var_name').focus();
      });
      return;
    }

    container.querySelector('#_metadata_var_name').addEventListener('input', function() {
      editVariable.name = this.value;
      variableChanged = true;
    });
    container.querySelector('#_metadata_var_type').addEventListener('change', function() {
      editVariable.type = this.value;
      editVariable.default = '';
      variableChanged = true;
      renderVariableEditor();
    });
    var defaultField = container.querySelector('#_metadata_var_default');
    defaultField.addEventListener('input', function() {
      editVariable.default = this.value;
      variableChanged = true;
    });
    defaultField.addEventListener('change', function() {
      editVariable.default = this.value;
      variableChanged = true;
    });
    var decrement = container.querySelector('#_metadata_var_dec');
    if (decrement) decrement.addEventListener('click', function() {
      editVariable.default = String(parseInt(editVariable.default || '0', 10) - 1);
      variableChanged = true;
      renderVariableEditor();
    });
    var increment = container.querySelector('#_metadata_var_inc');
    if (increment) increment.addEventListener('click', function() {
      editVariable.default = String(parseInt(editVariable.default || '0', 10) + 1);
      variableChanged = true;
      renderVariableEditor();
    });
    container.querySelector('#_metadata_var_clear').addEventListener('click', function() {
      editVariable = null;
      variableChanged = true;
      renderVariableEditor();
    });
  }

  renderVariableEditor();
  var computationEditor = new ComputationEditor(
    panel.querySelector('#_metadata_computation_rows'),
    parsed.tokens,
    parsed.error,
    function() {
      computationChanged = true;
      error.textContent = '';
    }
  );
  if (parsed.error) error.textContent = parsed.error;
  var generateQuestion = panel.querySelector('#_metadata_generate_question');
  if (generateQuestion) generateQuestion.addEventListener('click', async function() {
    generateQuestion.disabled = true;
    generateQuestion.textContent = 'Generating…';
    error.textContent = '';
    try {
      var question = await self._activityQuestionGenerator({
        id: bo.id,
        label: label.value.trim(),
        role: role.value.trim(),
        description: description.value.trim()
      });
      if (self._panel === panel) description.value = question;
    } catch (generationError) {
      if (self._panel === panel) {
        error.textContent = generationError instanceof Error ?
          generationError.message : 'Unable to generate a question.';
      }
    } finally {
      if (self._panel === panel) {
        generateQuestion.disabled = false;
        generateQuestion.textContent = 'Generate question';
      }
    }
  });
  panel.querySelector('#_metadata_add_token').addEventListener('click', function() {
    computationEditor.add();
  });
  tool.addEventListener('change', function() {
    toolChanged = true;
    if (tool.value) computationEditor.ensureToolInvocation();
    updateTrustedAvailability();
    renderVariableEditor();
  });
  description.focus();
  panel.querySelector('#_metadata_cancel').addEventListener('click', function() {
    self._closePanel();
  });
  panel.querySelector('#_metadata_save').addEventListener('click', function() {
    var priorityText = priority.value.trim();
    var priorityValue = priorityText === '' ? undefined : Number(priorityText);
    if (priorityText !== '' && !Number.isFinite(priorityValue)) {
      error.textContent = 'Priority must be a finite number.';
      return;
    }
    if (computationEditor.error) {
      error.textContent = computationEditor.error;
      return;
    }
    var computationError = validateComputation(computationEditor.computation);
    if (computationError) {
      error.textContent = computationError;
      return;
    }
    var properties = {
      label: label.value.trim() || undefined,
      role: role.value.trim() || undefined,
      description: description.value.trim() || undefined,
      priority: priorityValue,
      toolCall: toolChanged ? (tool.value || undefined) : originalTool,
      trusted: trusted.checked,
      computation: computationChanged ?
        (computationEditor.computation.length ?
          JSON.stringify(computationEditor.computation) : undefined) :
        originalComputation
    };
    if (supportsDataVariable && tool.value) {
      properties.eventData = self._moddle.create('dcr:EventData', {
        name: defaultToolVariableName(self, element, editVariable),
        type: 'String'
      });
    } else if (supportsDataVariable && variableChanged) {
      if (editVariable) {
        var variableName = editVariable.name.trim();
        if (!variableName) {
          error.textContent = 'Variable name is required.';
          return;
        }
        if (self._isVariableNameTakenElsewhere(variableName, element)) {
          error.textContent = 'Variable "' + variableName + '" is already declared on another activity.';
          return;
        }
        properties.eventData = self._moddle.create('dcr:EventData', {
          name: variableName,
          type: editVariable.type
        });
        if (editVariable.default.trim()) {
          properties.eventData['default'] = editVariable.default.trim();
        }
      } else {
        properties.eventData = undefined;
      }
    }
    if (tool.value) {
      properties.takesInput = false;
    } else if (originalTool && toolChanged) {
      properties.takesInput = undefined;
    }
    self._modeling.updateProperties(element, properties);
    self._closePanel();
  });
  panel.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Escape') self._closePanel();
  });
};

// ── Utility ───────────────────────────────────────────────────────────────

var FEEL_KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

function extractGuardVarNames(guardVal) {
  var stripped = guardVal.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  var names = new Set();
  var m;
  var pat = /[A-Za-z_][A-Za-z0-9_]*/g;
  while ((m = pat.exec(stripped)) !== null) {
    if (!FEEL_KEYWORDS.has(m[0])) names.add(m[0]);
  }
  return names;
}

GuardsAndTimeProvider.prototype._allVariableNames = function() {
  var names = new Set();
  this._elementRegistry.filter(function(el) {
    return el.type === 'dcr:Event' || el.type === 'dcr:SubProcess';
  }).forEach(function(el) {
    var bo = getBusinessObject(el);
    var v = bo.get('eventData');
    if (v && v.name) names.add(v.name);
  });
  return names;
};

GuardsAndTimeProvider.prototype._isVariableNameTakenElsewhere = function(name, element) {
  return this._elementRegistry.filter(function(el) {
    return (el.type === 'dcr:Event' || el.type === 'dcr:SubProcess') && el !== element;
  }).some(function(el) {
    var v = getBusinessObject(el).get('eventData');
    return v && v.name === name;
  });
};

GuardsAndTimeProvider.prototype._validateGuard = function(guardVal, pendingVariable) {
  if (!guardVal) return null;
  var syntaxErr = validateGuardSyntax(guardVal);
  if (syntaxErr) return syntaxErr;
  var knownVars = this._allVariableNames();
  if (pendingVariable) knownVars.add(pendingVariable);
  var usedVars = extractGuardVarNames(guardVal);
  if (usedVars.size === 0) {
    return 'Guard must reference at least one variable (e.g. amount > 0, delay>=2 and distance<=1500)';
  }
  for (var name of usedVars) {
    if (!knownVars.has(name)) {
      return 'Variable "' + name + '" is not defined on any activity in this graph.';
    }
  }
  return null;
};

GuardsAndTimeProvider.prototype._validateValue = function(value, pendingVariable) {
  var syntaxErr = validateGuardSyntax(value);
  if (syntaxErr) return syntaxErr;
  var knownVars = this._allVariableNames();
  if (pendingVariable) knownVars.add(pendingVariable);
  for (var name of extractGuardVarNames(value)) {
    if (!knownVars.has(name)) {
      return 'Variable "' + name + '" is not defined on any activity in this graph.';
    }
  }
  return null;
};

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
