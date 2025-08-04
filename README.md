# InfoGata Browser Extension

This extension enables addtional functionality to [audiogata](https://github.com/InfoGata/audiogata), [videogata](https://github.com/InfoGata/videogata), and [readergata](https://gitlab.com/elijahgreen/readergata) plugins.

It currently enables the following:

1. Allows the plugins to fetch urls without a cors proxy, which some plugins need.
2. Allows some plugins to make authenticated requests to websites if the user enables the plugin to.

## Installation

Firefox: https://addons.mozilla.org/en-US/firefox/addon/infogata-extension/

Chrome:

1. [Download the extension](https://github.com/InfoGata/infogata-extension/releases/download/1.0.0/chrome-extension.zip)
2. Unzip the extension file
3. Follow these instructions: https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked

## Building

### Development
```sh
npm install
npm run dev            # Chrome development server
npm run dev:firefox    # Firefox development server
```

### Production builds
```sh
npm install
npm run build          # Build for Chrome
npm run build:firefox  # Build for Firefox
```

### Create distribution packages
```sh
npm run zip            # Create Chrome extension zip
npm run zip:firefox    # Create Firefox extension zip
```

### Testing
```sh
npm test               # Run Jest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage
```

## Credits

Styling and assets of options.html comes from [hoppscotch/hoppscotch-extension](https://github.com/hoppscotch/hoppscotch-extension)
