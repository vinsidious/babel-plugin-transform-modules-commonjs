import template from '@babel/template';

export const buildRequire = template(`
  require(MODULE);
`);

export const buildExportsModuleDeclaration = template(`
  Object.defineProperty(exports, "__esModule", {
    value: true
  });
`);

export const buildExportsFrom = template(`
  Object.defineProperty(exports, PROPERTY, {
    enumerable: true,
    get: function () {
      return VALUE;
    }
  });
`);

export const buildLooseExportsModuleDeclaration = template(`
  exports.__esModule = true;
`);

export const buildExportsAssignment = template(`
  exports.IDENTIFIER = VALUE;
`);

export const buildExportAll = template(`
  Object.keys(OBJECT).forEach(function (key) {
    if (key === "default") return;
    Object.defineProperty(exports, key, {
      enumerable: true,
      get: function () {
        return OBJECT[key];
      }
    });
  });
`);

export const buildDefaultExport = template(`module.exports = exports['default']`);
