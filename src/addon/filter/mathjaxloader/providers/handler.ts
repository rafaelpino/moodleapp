// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable, ViewContainerRef } from '@angular/core';
import { CoreFilterDefaultHandler } from '@core/filter/providers/default-filter';
import { CoreFilterFilter, CoreFilterFormatTextOptions } from '@core/filter/providers/filter';
import { CoreEventsProvider } from '@providers/events';
import { CoreLangProvider } from '@providers/lang';
import { CoreSitesProvider } from '@providers/sites';
import { CoreTextUtilsProvider } from '@providers/utils/text';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreSite } from '@classes/site';

/**
 * Handler to support the MathJax filter.
 */
@Injectable()
export class AddonFilterMathJaxLoaderHandler extends CoreFilterDefaultHandler {
    name = 'AddonFilterMathJaxLoaderHandler';
    filterName = 'mathjaxloader';

    // Default values for MathJax config for sites where we cannot retrieve it.
    protected DEFAULT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.2/MathJax.js';
    protected DEFAULT_CONFIG = `
        MathJax.Hub.Config({
            extensions: [
                "Safe.js",
                "tex2jax.js",
                "mml2jax.js",
                "MathEvents.js",
                "MathZoom.js",
                "MathMenu.js",
                "toMathML.js",
                "TeX/noErrors.js",
                "TeX/noUndefined.js",
                "TeX/AMSmath.js",
                "TeX/AMSsymbols.js",
                "fast-preview.js",
                "AssistiveMML.js",
                "[a11y]/accessibility-menu.js"
            ],
            jax: ["input/TeX","input/MathML","output/SVG"],
            menuSettings: {
                zoom: "Double-Click",
                mpContext: true,
                mpMouse: true
            },
            errorSettings: { message: ["!"] },
            skipStartupTypeset: true,
            messageStyle: "none"
        });
    `;

    // List of language codes found in the MathJax/localization/ directory.
    protected MATHJAX_LANG_CODES = [
            'ar', 'ast', 'bcc', 'bg', 'br', 'ca', 'cdo', 'ce', 'cs', 'cy', 'da', 'de', 'diq', 'en', 'eo', 'es', 'fa',
            'fi', 'fr', 'gl', 'he', 'ia', 'it', 'ja', 'kn', 'ko', 'lb', 'lki', 'lt', 'mk', 'nl', 'oc', 'pl', 'pt',
            'pt-br', 'qqq', 'ru', 'scn', 'sco', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-hans', 'zh-hant'
        ];

    // List of explicit mappings and known exceptions (moodle => mathjax).
    protected EXPLICIT_MAPPING = {
            'zh-tw': 'zh-hant',
            'zh-cn': 'zh-hans',
        };

    protected window: any = window; // Convert the window to <any> to be able to use non-standard properties like MathJax.

    constructor(eventsProvider: CoreEventsProvider,
            private langProvider: CoreLangProvider,
            private sitesProvider: CoreSitesProvider,
            private textUtils: CoreTextUtilsProvider,
            private utils: CoreUtilsProvider) {
        super();

        // Load the JS.
        this.loadJS();

        // Get the current language.
        this.langProvider.getCurrentLanguage().then((lang) => {
            lang = this.mapLanguageCode(lang);

            // Now call the configure function.
            this.window.M.filter_mathjaxloader.configure({
                mathjaxconfig: this.DEFAULT_CONFIG,
                lang: lang
            });
        });

        // Update MathJax locale if app language changes.
        eventsProvider.on(CoreEventsProvider.LANGUAGE_CHANGED, (lang) => {
            if (typeof this.window.MathJax != 'undefined') {
                lang = this.mapLanguageCode(lang);

                this.window.MathJax.Hub.Queue(() => {
                    this.window.MathJax.Localization.setLocale(lang);
                });
            }
        });
    }

    /**
     * Filter some text.
     *
     * @param text The text to filter.
     * @param filter The filter.
     * @param options Options passed to the filters.
     * @param siteId Site ID. If not defined, current site.
     * @return Filtered text (or promise resolved with the filtered text).
     */
    filter(text: string, filter: CoreFilterFilter, options: CoreFilterFormatTextOptions, siteId?: string)
            : string | Promise<string> {

        return this.sitesProvider.getSite(siteId).then((site) => {

            // Don't apply this filter if Moodle is 3.7 or higher and the WS already filtered the content.
            if (!options.wsNotFiltered && site.isVersionGreaterEqualThan('3.7')) {
                return text;
            }

            if (text.indexOf('class="filter_mathjaxloader_equation"') != -1) {
                // The content seems to have treated mathjax already, don't do it.
                return text;
            }

            // We cannot get the filter settings, so we cannot know if it can be used as a replacement for the TeX filter.
            // Assume it cannot (default value).
            let hasDisplayOrInline = false;
            if (text.match(/\\[\[\(]/) || text.match(/\$\$/)) {
                // Only parse the text if there are mathjax symbols in it.
                // The recognized math environments are \[ \] and $$ $$ for display mathematics and \( \) for inline mathematics.
                // Wrap display and inline math environments in nolink spans.
                const result = this.wrapMathInNoLink(text);
                text = result.text;
                hasDisplayOrInline = result.changed;
            }

            if (hasDisplayOrInline) {
                return '<span class="filter_mathjaxloader_equation">' + text + '</span>';
            }

            return text;
        });
    }

    /**
     * Handle HTML. This function is called after "filter", and it will receive an HTMLElement containing the text that was
     * filtered.
     *
     * @param container The HTML container to handle.
     * @param filter The filter.
     * @param options Options passed to the filters.
     * @param viewContainerRef The ViewContainerRef where the container is.
     * @param component Component.
     * @param componentId Component ID.
     * @param siteId Site ID. If not defined, current site.
     * @return If async, promise resolved when done.
     */
    handleHtml(container: HTMLElement, filter: CoreFilterFilter, options: CoreFilterFormatTextOptions,
            viewContainerRef: ViewContainerRef, component?: string, componentId?: string | number, siteId?: string)
            : void | Promise<void> {

        return this.waitForReady().then(() => {
            this.window.M.filter_mathjaxloader.typeset(container);
        });
    }

    /**
     * Wrap a portion of the $text inside a no link span. The whole text is then returned.
     *
     * @param text The text to modify.
     * @param start The start index of the substring in text that should be wrapped in the span.
     * @param end The end index of the substring in text that should be wrapped in the span.
     * @return The whole text with the span inserted around the defined substring.
     */
    protected insertSpan(text: string, start: number, end: number): string {
        return this.textUtils.substrReplace(text,
                '<span class="nolink">' + text.substr(start, end - start + 1) + '</span>',
                start,
                end - start + 1);
    }

    /**
     * Check if the JS library has been loaded.
     *
     * @return Whether the library has been loaded.
     */
    protected jsLoaded(): boolean {
        return this.window.M && this.window.M.filter_mathjaxloader;
    }

    /**
     * Load the JS to make MathJax work in the app. The JS loaded is extracted from Moodle filter's loader JS file.
     */
    protected loadJS(): void {
        // tslint:disable: no-this-assignment
        const that = this;

        this.window.M = this.window.M || {};
        this.window.M.filter_mathjaxloader = this.window.M.filter_mathjaxloader || {
            _lang: '',
            _configured: false,
            // Add the configuration to the head and set the lang.
            configure: function (params: any): void {
                // Add a js configuration object to the head.
                const script = document.createElement('script');
                script.type = 'text/x-mathjax-config';
                script.text = params.mathjaxconfig;
                document.head.appendChild(script);

                // Save the lang config until MathJax is actually loaded.
                this._lang = params.lang;
            },
            // Set the correct language for the MathJax menus.
            _setLocale: function (): void {
                if (!this._configured) {
                    const lang = this._lang;

                    if (typeof that.window.MathJax != 'undefined') {
                        that.window.MathJax.Hub.Queue(() => {
                            that.window.MathJax.Localization.setLocale(lang);
                        });
                        that.window.MathJax.Hub.Configured();
                        this._configured = true;
                    }
                }
            },
            // Called by the filter when an equation is found while rendering the page.
            typeset: function (container: HTMLElement): void {
                if (!this._configured) {
                    this._setLocale();
                }

                if (typeof that.window.MathJax != 'undefined') {
                    const processDelay = that.window.MathJax.Hub.processSectionDelay;
                    // Set the process section delay to 0 when updating the formula.
                    that.window.MathJax.Hub.processSectionDelay = 0;

                    const equations = Array.from(container.querySelectorAll('.filter_mathjaxloader_equation'));
                    equations.forEach((node) => {
                        that.window.MathJax.Hub.Queue(['Typeset', that.window.MathJax.Hub, node]);
                    });

                    // Set the delay back to normal after processing.
                    that.window.MathJax.Hub.processSectionDelay = processDelay;
                }
            }
        };
    }

    /**
     * Perform a mapping of the app language code to the equivalent for MathJax.
     *
     * @param langCode The app language code.
     * @return The MathJax language code.
     */
    protected mapLanguageCode(langCode: string): string {

        // If defined, explicit mapping takes the highest precedence.
        if (this.EXPLICIT_MAPPING[langCode]) {
            return this.EXPLICIT_MAPPING[langCode];
        }

        // If there is exact match, it will be probably right.
        if (this.MATHJAX_LANG_CODES.indexOf(langCode) != -1) {
            return langCode;
        }

        // Finally try to find the best matching mathjax pack.
        const parts = langCode.split('-');
        if (this.MATHJAX_LANG_CODES.indexOf(parts[0]) != -1) {
            return parts[0];
        }

        // No more guessing, use default language.
        return this.langProvider.getDefaultLanguage();
    }

    /**
     * Check if the filter should be applied in a certain site based on some filter options.
     *
     * @param options Options.
     * @param site Site.
     * @return Whether filter should be applied.
     */
    shouldBeApplied(options: CoreFilterFormatTextOptions, site?: CoreSite): boolean {
        // Only apply the filter if logged in and we're filtering current site.
        return site && site.getId() == this.sitesProvider.getCurrentSiteId();
    }

    /**
     * Wait for the MathJax library and our JS object to be loaded.
     *
     * @param retries Number of times this has been retried.
     * @return Promise resolved when ready or if it took too long to load.
     */
    protected waitForReady(retries: number = 0): Promise<any> {
        if ((this.window.MathJax && this.jsLoaded()) || retries >= 20) {
            // Loaded or too many retries, stop.
            return Promise.resolve();
        }

        const deferred = this.utils.promiseDefer();

        setTimeout(() => {
            return this.waitForReady(retries + 1).finally(() => {
                deferred.resolve();
            });
        }, 250);

        return deferred.promise;
    }

    /**
     * Find math environments in the $text and wrap them in no link spans
     * (<span class="nolink"></span>). If math environments are nested, only
     * the outer environment is wrapped in the span.
     *
     * The recognized math environments are \[ \] and $$ $$ for display
     * mathematics and \( \) for inline mathematics.
     *
     * @param text The text to filter.
     * @return Object containing the potentially modified text and a boolean that is true if any changes were made to the text.
     */
    protected wrapMathInNoLink(text: string): {text: string, changed: boolean} {
        let len = text.length,
            i = 1,
            displayStart = -1,
            displayBracket = false,
            displayDollar = false,
            inlineStart = -1,
            changesDone = false;

        // Loop over the $text once.
        while (i < len) {
            if (displayStart === -1) {
                // No display math has started yet.
                if (text[i - 1] === '\\') {

                    if (text[i] === '[') {
                        // Display mode \[ begins.
                        displayStart = i - 1;
                        displayBracket = true;
                    } else if (text[i] === '(') {
                        // Inline math \( begins, not nested inside display math.
                        inlineStart = i - 1;
                    } else if (text[i] === ')' && inlineStart > -1) {
                        // Inline math ends, not nested inside display math. Wrap the span around it.
                        text = this.insertSpan(text, inlineStart, i);

                        inlineStart = -1; // Reset.
                        i += 28; // The text length changed due to the <span>.
                        len += 28;
                        changesDone = true;
                    }

                } else if (text[i - 1] === '$' && text[i] === '$') {
                    // Display mode $$ begins.
                    displayStart = i - 1;
                    displayDollar = true;
                }

            } else {
                // Display math open.
                if ((text[i - 1] === '\\' && text[i] === ']' && displayBracket) ||
                        (text[i - 1] === '$' && text[i] === '$' && displayDollar)) {
                    // Display math ends, wrap the span around it.
                    text = this.insertSpan(text, displayStart, i);

                    displayStart = -1; // Reset.
                    displayBracket = false;
                    displayDollar = false;
                    i += 28; // The text length changed due to the <span>.
                    len += 28;
                    changesDone = true;
                }
            }

            i++;
        }

        return {
            text: text,
            changed: changesDone
        };
    }
}
