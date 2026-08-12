/**
 * Map containing SVG paths needed by BpmnRenderer
 */
export default function PathMap() {

  /**
   * Contains a map of path elements
   *
   * <h1>Path definition</h1>
   * A parameterized path is defined like this:
   * <pre>
   * 'GATEWAY_PARALLEL': {
   *   d: 'm {mx},{my} {e.x0},0 0,{e.x1} {e.x1},0 0,{e.y0} -{e.x1},0 0,{e.y1} ' +
          '-{e.x0},0 0,-{e.y1} -{e.x1},0 0,-{e.y0} {e.x1},0 z',
   *   height: 17.5,
   *   width:  17.5,
   *   heightElements: [2.5, 7.5],
   *   widthElements: [2.5, 7.5]
   * }
   * </pre>
   * <p>It's important to specify a correct <b>height and width</b> for the path as the scaling
   * is based on the ratio between the specified height and width in this object and the
   * height and width that is set as scale target (Note x,y coordinates will be scaled with
   * individual ratios).</p>
   * <p>The '<b>heightElements</b>' and '<b>widthElements</b>' array must contain the values that will be scaled.
   * The scaling is based on the computed ratios.
   * Coordinates on the y axis should be in the <b>heightElement</b>'s array, they will be scaled using
   * the computed ratio coefficient.
   * In the parameterized path the scaled values can be accessed through the 'e' object in {} brackets.
   *   <ul>
   *    <li>The values for the y axis can be accessed in the path string using {e.y0}, {e.y1}, ....</li>
   *    <li>The values for the x axis can be accessed in the path string using {e.x0}, {e.x1}, ....</li>
   *   </ul>
   *   The numbers x0, x1 respectively y0, y1, ... map to the corresponding array index.
   * </p>
   */
  this.pathMap = {
    
    'MARKER_PENDING': {
      d: 'm {mx},{my} c0,0,0,0,0,0c0,-1.79,1.34,-3.25,3,-3.25c1.66,'+
      '0,3,1.46,3,3.25c0,0,0,0,0,0c0,1.8,-1.34,3.25,-3,3.25c-1.66,0,'+
      '-3,-1.45,-3,-3.25c0,0,0,0,0,0zm0.29,-19.5c-0.01,-0.1,-0.01,'+
      '-0.21,-0.01,-0.31c0,-1.62,1.21,-2.94,2.71,-2.94c1.5,0,2.72,'+
      '1.32,2.72,2.94c0,0.1,-0.01,0.21,-0.02,0.31c0,0,-1.05,11.39,'+
      '-1.05,11.39c-0.08,0.9,-0.79,1.61,-1.65,1.61c-0.85,0,-1.56,'+
      '-0.71,-1.65,-1.61c0,0,-1.05,-11.39,-1.05,-11.39z',

      height: 10,
      width: 10,
      heightElements: [],
      widthElements: []
    },
    
    'MARKER_EXECUTED': {

      d: 'm {mx},{my} c3.45,3.86,6.8,7.34,10.02,11.74c3.49,-7.2,7.07,'+
      '-14.42,12.98,-22.25c0,0,-1.59,-0.75,-1.59,-0.75c-4.99,5.47,-8.86,'+
      '10.65,-12.23,16.81c-2.34,-2.18,-6.13,-5.27,-8.44,-6.86c0,0,-0.74,'+
      '1.31,-0.74,1.31z',
      
      height: 4,
      width: 15,
      heightElements: [],
      widthElements: []
    },

    'MARKER_NESTING': {

      d: 'm {mx},{my} l -2.25 0 l 0 -13 l 2.175 0 l 0 2.175 q 0.7 -0.95,'+
      ' 1.788 -1.762 a 4.329 4.329 0 0 1 1.776 -0.656 a 5.657 5.657 0 0 1 0.811,'+
      ' -0.056 a 5.806 5.806 0 0 1 1.266 0.13 q 0.836 0.186 1.445 0.643 a 3.315,'+
      ' 3.315 0 0 1 0.576 0.552 a 4.601 4.601 0 0 1 0.902 1.845 q 0.163 0.66 0.183,'+
      ' 1.432 a 8.441 8.441 0 0 1 0.003 0.223 l 0 8.475 l -2.25 0 l 0 -8.225 q 0,'+
      ' -1.148 -0.445 -1.926 a 2.741 2.741 0 0 0 -0.217 -0.324 a 2.145 2.145 0 0 0,'+
      ' -1.57 -0.838 a 3.015 3.015 0 0 0 -0.268 -0.012 a 3.28 3.28 0 0 0 -1.712 0.491,'+
      ' a 4.338 4.338 0 0 0 -0.463 0.322 q -1.025 0.812 -1.75 1.912 l 0 8.6 Z',


      height: 4,
      width: 15,
      heightElements: [],
      widthElements: []
    },

    'MARKER_SUBPROCESS': {

      d: 'm {mx},{my} l0.95,-1.875a4.639,4.639,0,0,0,0.786,0.531q0.389,0.212,0.852,'+
      ' 0.382a6.018,6.018,0,0,0,1.902,0.359a6.866,6.866,0,0,0,0.21,0.003a6.778,6.778,'+
      ' 0,0,0,0.771,-0.041q0.796,-0.091,1.288,-0.388a1.934,1.934,0,0,0,0.054,'+
      ' -0.033a1.862,1.862,0,0,0,0.383,-0.324a1.263,1.263,0,0,0,0.329,-0.864a1.781,'+
      ' 1.781,0,0,0,-0.079,-0.537a1.553,1.553,0,0,0,-0.183,-0.388q-0.263,-0.4,-0.963,'+
      ' -0.787a7.116,7.116,0,0,0,-0.499,-0.249q-0.529,-0.24,-1.276,-0.503a25.896,'+
      ' 25.896,0,0,0,-0.25,-0.086a11.654,11.654,0,0,1,-1.099,-0.436q-1.025,-0.472,'+
      ' -1.638,-1.051a2.831,2.831,0,0,1,-0.824,-1.5a4.198,4.198,0,0,1,-0.089,-0.888a3.03,'+
      ' 3.03,0,0,1,0.987,-2.254a4.366,4.366,0,0,1,0.326,-0.283a4.441,4.441,0,0,1,1.509,'+
      ' -0.762q0.929,-0.276,2.128,-0.276q1.25,0,2.225,0.263a9.692,9.692,0,0,1,1.034,'+
      ' 0.338a7.778,7.778,0,0,1,0.716,0.324l-0.625,1.85a6.132,6.132,0,0,0,-0.917,'+
      ' -0.441a7.548,7.548,0,0,0,-0.62,-0.209q-0.863,-0.25,-1.913,-0.25a5.158,5.158,0,'+
      ' 0,0,-0.734,0.049q-0.772,0.111,-1.241,0.476a2.33,2.33,0,0,0,-0.339,0.318q-0.176,'+
      ' 0.205,-0.26,0.423a1.132,1.132,0,0,0,-0.076,0.409a1.23,1.23,0,0,0,0.374,0.888a1.771,'+
      ' 1.771,0,0,0,0.151,0.137q0.516,0.418,2,0.908a21.155,21.155,0,0,0,0.05,0.017a16.938,'+
      ' 16.938,0,0,1,1.266,0.475q1.203,0.511,1.892,1.082a3.737,3.737,0,0,1,0.292,0.268q0.975,'+
      ' 1,0.975,2.5a3.468,3.468,0,0,1,-0.266,1.379q-0.346,0.81,-1.146,1.384q-1.185,0.849,'+
      ' -3.048,0.986a10.106,10.106,0,0,1,-0.74,0.026a9.997,9.997,0,0,1,-1.465,-0.103a7.737,'+
      ' 7.737,0,0,1,-1.197,-0.272a7.721,7.721,0,0,1,-0.961,-0.371q-0.566,-0.266,-1.002,-0.604z',
      
      
      height: 4,
      width: 15,
      heightElements: [],
      widthElements: []
    },

    'MARKER_MULTI_INSTANCE': {

      d: 'm{mx},{my} m 3,2 l 0,10 m 3,-10 l 0,10 m 3,-10 l 0,10',

      height: 10,
      width: 10,
      heightElements: [],
      widthElements: []
    },

  };

  /**
   * Return raw path for the given ID.
   *
   * @param {string} pathId
   *
   * @return {string} raw path
   */
  this.getRawPath = function getRawPath(pathId) {
    return this.pathMap[pathId].d;
  };

  /**
   * Scales the path to the given height and width.
   * <h1>Use case</h1>
   * <p>Use case is to scale the content of elements (event, gateways) based
   * on the element bounding box's size.
   * </p>
   * <h1>Why not transform</h1>
   * <p>Scaling a path with transform() will also scale the stroke and IE does not support
   * the option 'non-scaling-stroke' to prevent this.
   * Also there are use cases where only some parts of a path should be
   * scaled.</p>
   *
   * @param {string} pathId The ID of the path.
   * @param {Object} param <p>
   *   Example param object scales the path to 60% size of the container (data.width, data.height).
   *   <pre>
   *   {
   *     xScaleFactor: 0.6,
   *     yScaleFactor:0.6,
   *     containerWidth: data.width,
   *     containerHeight: data.height,
   *     position: {
   *       mx: 0.46,
   *       my: 0.2,
   *     }
   *   }
   *   </pre>
   *   <ul>
   *    <li>targetpathwidth = xScaleFactor * containerWidth</li>
   *    <li>targetpathheight = yScaleFactor * containerHeight</li>
   *    <li>Position is used to set the starting coordinate of the path. M is computed:
    *    <ul>
    *      <li>position.x * containerWidth</li>
    *      <li>position.y * containerHeight</li>
    *    </ul>
    *    Center of the container <pre> position: {
   *       mx: 0.5,
   *       my: 0.5,
   *     }</pre>
   *     Upper left corner of the container
   *     <pre> position: {
   *       mx: 0.0,
   *       my: 0.0,
   *     }</pre>
   *    </li>
   *   </ul>
   * </p>
   *
   * @return {string} scaled path
   */
  this.getScaledPath = function getScaledPath(pathId, param) {
    var rawPath = this.pathMap[pathId];

    // positioning
    // compute the start point of the path
    var mx, my;

    if (param.abspos) {
      mx = param.abspos.x;
      my = param.abspos.y;
    } else {
      mx = param.containerWidth * param.position.mx;
      my = param.containerHeight * param.position.my;
    }

    var coordinates = {}; // map for the scaled coordinates
    if (param.position) {

      // path
      var heightRatio = (param.containerHeight / rawPath.height) * param.yScaleFactor;
      var widthRatio = (param.containerWidth / rawPath.width) * param.xScaleFactor;


      // Apply height ratio
      for (var heightIndex = 0; heightIndex < rawPath.heightElements.length; heightIndex++) {
        coordinates['y' + heightIndex] = rawPath.heightElements[heightIndex] * heightRatio;
      }

      // Apply width ratio
      for (var widthIndex = 0; widthIndex < rawPath.widthElements.length; widthIndex++) {
        coordinates['x' + widthIndex] = rawPath.widthElements[widthIndex] * widthRatio;
      }
    }

    // Apply value to raw path
    var path = format(
      rawPath.d, {
        mx: mx,
        my: my,
        e: coordinates
      }
    );
    return path;
  };
}

// helpers //////////////////////

// copied and adjusted from https://github.com/adobe-webplatform/Snap.svg/blob/master/src/svg.js
var tokenRegex = /\{([^{}]+)\}/g,
    objNotationRegex = /(?:(?:^|\.)(.+?)(?=\[|\.|$|\()|\[('|")(.+?)\2\])(\(\))?/g; // matches .xxxxx or ["xxxxx"] to run over object properties

function replacer(all, key, obj) {
  var res = obj;
  key.replace(objNotationRegex, function(all, name, quote, quotedName, isFunc) {
    name = name || quotedName;
    if (res) {
      if (name in res) {
        res = res[name];
      }
      typeof res == 'function' && isFunc && (res = res());
    }
  });
  res = (res == null || res == obj ? all : res) + '';

  return res;
}

function format(str, obj) {
  return String(str).replace(tokenRegex, function(all, key) {
    return replacer(all, key, obj);
  });
}