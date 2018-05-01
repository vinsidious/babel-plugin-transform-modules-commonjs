import * as babel from '@babel/core';
import prettier from 'prettier';

import transformModules from '..';

function transform(code) {
  return format(
    babel.transformSync(code, {
      parserOpts: { allowImportExportEverywhere: true },
      plugins: [transformModules],
    }).code,
  );
}

const format = code => prettier.format(code.replace(/\n/g, ''), { singleQuote: true });

describe(`module transform plugin`, () => {
  describe(`imports`, () => {
    it(`works with default imports`, () => {
      const originalCode = `import _ from 'lodash'`;
      const expectedValue = format(`
        var _lodash = require('lodash');
        var _ = _interopRequireDefault(_lodash).default;
        function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
      `);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });

    it(`works with named imports`, () => {
      const originalCode = `import { get, filter } from 'lodash'`;
      const expectedValue = format(`
        var _lodash = require('lodash');
        var get = _lodash.get;
        var filter = _lodash.filter;
      `);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });

    it(`works with side-effect-only imports`, () => {
      const originalCode = `import 'lodash'`;
      const expectedValue = format(`require('lodash')`);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });

    it(`works with namespace imports`, () => {
      const originalCode = `import * as _ from 'lodash'`;
      const expectedValue = format(`
        var _lodash = require('lodash');
        var _ = _interopRequireWildcard(_lodash);
        function _interopRequireWildcard(obj) {
          if (obj && obj.__esModule) {
            return obj;
          } else {
            var newObj = {};
            if (obj != null) {
              for (var key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                  var desc =
                    Object.defineProperty && Object.getOwnPropertyDescriptor
                      ? Object.getOwnPropertyDescriptor(obj, key)
                      : {};
                  if (desc.get || desc.set) {
                    Object.defineProperty(newObj, key, desc);
                  } else {
                    newObj[key] = obj[key];
                  }
                }
              }
            }
            newObj.default = obj;
            return newObj;
          }
        }
      `);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });
  });

  describe(`exports`, () => {
    it(`works with default exports`, () => {
      const originalCode = `export default foo`;
      const expectedValue = format(`
        Object.defineProperty(exports, '__esModule', { value: true });
        exports.default = foo;
      `);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });

    it(`works with named exports`, () => {
      const originalCode = `export { foo, bar }`;
      const expectedValue = format(`
        Object.defineProperty(exports, '__esModule', { value: true });
        exports.foo = foo;
        exports.bar = bar;
      `);
      const transformedCode = transform(originalCode);
      expect(transformedCode).toBe(expectedValue);
    });
  });
});
