/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import { InterlinearSetupXmlParser } from 'parsers/pt9/interlinearSetupXmlParser';

describe('InterlinearSetupXmlParser', () => {
  let parser: InterlinearSetupXmlParser;

  beforeEach(() => {
    parser = new InterlinearSetupXmlParser();
  });

  describe('parse() - valid XML', () => {
    it('parses a setup with every field populated', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup type="BackTranslation" language="fr">
            <LanguageName>French</LanguageName>
            <FontName>Arial</FontName>
            <FontSize>10</FontSize>
            <RightToLeft>false</RightToLeft>
            <RelatedLanguages>true</RelatedLanguages>
            <ExportOnApprove>true</ExportOnApprove>
            <MdlScrTextName>MDL</MdlScrTextName>
            <MdlScrTextId>1234567890abcdef</MdlScrTextId>
            <MdlIsResource>true</MdlIsResource>
            <ExportScrTextName>BT1</ExportScrTextName>
            <ExportScrTextId>fedcba0987654321</ExportScrTextId>
          </InterlinearSetup>
        </InterlinearSetupList>
      `;

      expect(parser.parse(xml)).toStrictEqual({
        Setups: [
          {
            Type: 'BackTranslation',
            LanguageId: 'fr',
            LanguageName: 'French',
            FontName: 'Arial',
            FontSize: '10',
            RightToLeft: false,
            RelatedLanguages: true,
            ExportOnApprove: true,
            MdlScrTextName: 'MDL',
            MdlScrTextId: '1234567890abcdef',
            MdlIsResource: true,
            ExportScrTextName: 'BT1',
            ExportScrTextId: 'fedcba0987654321',
          },
        ],
      });
    });

    it('parses an empty root element as no setups', () => {
      expect(parser.parse('<InterlinearSetupList />')).toStrictEqual({ Setups: [] });
    });

    it('parses a root with no InterlinearSetup children as no setups', () => {
      expect(parser.parse('<InterlinearSetupList><dummy /></InterlinearSetupList>')).toStrictEqual({
        Setups: [],
      });
    });

    it('parses an empty InterlinearSetup element as a setup with no fields', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup />
        </InterlinearSetupList>
      `;
      expect(parser.parse(xml)).toStrictEqual({ Setups: [{}] });
    });

    it('keeps absent fields absent on a setup with attributes only', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup type="Glossing" language="en"></InterlinearSetup>
        </InterlinearSetupList>
      `;
      expect(parser.parse(xml)).toStrictEqual({
        Setups: [{ Type: 'Glossing', LanguageId: 'en' }],
      });
    });

    it('parses a setup with every field empty as empty strings and false booleans', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup type="" language="">
            <LanguageName />
            <FontName />
            <FontSize />
            <RightToLeft />
            <RelatedLanguages />
            <ExportOnApprove />
            <MdlScrTextName />
            <MdlScrTextId />
            <MdlIsResource />
            <ExportScrTextName />
            <ExportScrTextId />
          </InterlinearSetup>
        </InterlinearSetupList>
      `;
      expect(parser.parse(xml)).toStrictEqual({
        Setups: [
          {
            Type: '',
            LanguageId: '',
            LanguageName: '',
            FontName: '',
            FontSize: '',
            RightToLeft: false,
            RelatedLanguages: false,
            ExportOnApprove: false,
            MdlScrTextName: '',
            MdlScrTextId: '',
            MdlIsResource: false,
            ExportScrTextName: '',
            ExportScrTextId: '',
          },
        ],
      });
    });

    it('parses an unrecognized boolean element text as false', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup>
            <RightToLeft>maybe</RightToLeft>
          </InterlinearSetup>
        </InterlinearSetupList>
      `;
      expect(parser.parse(xml).Setups[0].RightToLeft).toBe(false);
    });

    it('parses an unknown interlinear type name as its raw string', () => {
      const xml = `
        <InterlinearSetupList>
          <InterlinearSetup type="FutureType" language="en" />
        </InterlinearSetupList>
      `;
      expect(parser.parse(xml).Setups[0].Type).toBe('FutureType');
    });

    it('parses the real test-data setup fixture', () => {
      const xmlPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'test-data',
        'InterlinearSetup.xml',
      );
      const result = parser.parse(fs.readFileSync(xmlPath, 'utf-8'));

      expect(result.Setups).toStrictEqual([
        {
          Type: 'Glossing',
          LanguageId: 'en',
          LanguageName: 'English',
          FontName: 'Charis SIL',
          FontSize: '12',
          RightToLeft: false,
          RelatedLanguages: false,
          ExportOnApprove: false,
        },
        {
          Type: 'BackTranslation',
          LanguageId: 'fr',
          LanguageName: 'French',
          MdlScrTextName: 'MDL',
          MdlScrTextId: '1234567890abcdef',
          MdlIsResource: true,
          ExportOnApprove: true,
          ExportScrTextName: 'BT1',
          ExportScrTextId: 'fedcba0987654321',
        },
      ]);
    });
  });

  describe('parse() - invalid XML / errors', () => {
    it('throws when the InterlinearSetupList root element is absent', () => {
      expect(() => parser.parse('<OtherRoot />')).toThrow(
        expect.objectContaining({
          name: 'SyntaxError',
          message: expect.stringContaining(
            'Invalid XML: Missing InterlinearSetupList root element',
          ),
        }),
      );
    });
  });
});
