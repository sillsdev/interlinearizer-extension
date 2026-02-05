/**
 * Jest mock for webpack ?raw XML import. Exports the contents of test-data/Interlinear_en_MAT.xml
 * so interlinearizer.web-view.tsx can parse it in unit tests without webpack.
 */
const fs = require('fs');
const path = require('path');

const xmlPath = path.join(__dirname, '..', 'test-data', 'Interlinear_en_MAT.xml');
module.exports = fs.readFileSync(xmlPath, 'utf-8');
