# InfoGata Browser Extension

This extension enables addtional functionality to [audiogata](https://github.com/InfoGata/audiogata), [videogata](https://github.com/InfoGata/videogata), and [readergata](https://gitlab.com/elijahgreen/readergata) plugins.

It currently allows the fetching of urls without a cors proxy, which some plugins need.

## Installation

Firefox: https://addons.mozilla.org/en-US/firefox/addon/infogata-extension/

## Building

```sh
npm install
npm run create-zip:firefox
```

or

```sh
npm install
npm run create-zip:chrome
```

## Credits

Styling and assets of options.html comes from [hoppscotch/hoppscotch-extension](https://github.com/hoppscotch/hoppscotch-extension)
