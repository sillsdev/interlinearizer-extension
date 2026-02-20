/**
 * @file Jest mock for webpack ?raw XML import. Exports the contents of test-data/Lexicon.xml
 * so interlinearizer.web-view.tsx can parse it in unit tests without webpack.
 */
import fs from 'fs';
import path from 'path';

const xmlPath = path.join(__dirname, '..', 'test-data', 'Lexicon.xml');
module.exports = fs.readFileSync(xmlPath, 'utf-8');
