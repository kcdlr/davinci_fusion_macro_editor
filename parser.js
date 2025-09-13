// parser.js

/**
 * Finds a block enclosed by braces, handling nested braces correctly.
 * @param {string} text The text to search within.
 * @param {RegExp} headerRegex The regex to find the header immediately preceding the opening brace.
 * @param {number} [searchFrom=0] The index to start searching from.
 * @param {boolean} [consumeComma=false] If true, consumes a trailing comma and whitespace after the block.
 * @returns {object|null} An object with `header`, `content`, `fullText`, `startIndex`, and `endIndex`, or null.
 */
function findBlock(text, headerRegex, searchFrom = 0, consumeComma = true) {
    const searchText = text.substring(searchFrom);
    const match = searchText.match(headerRegex);
    if (!match) return null;

    const header = match[0];
    const startIndex = match.index + searchFrom;
    const contentStartIndex = startIndex + header.length;

    let braceCount = 1;
    let contentEndIndex = -1;
    for (let i = contentStartIndex; i < text.length; i++) {
        if (text[i] === '{') {
            braceCount++;
        } else if (text[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                contentEndIndex = i;
                break;
            }
        }
    }
    if (contentEndIndex === -1) return null;

    let endIndex = contentEndIndex + 1; // `}` の直後を指す

    if (consumeComma) {
        const trailingText = text.substring(endIndex);
        const commaMatch = trailingText.match(/^[\s\t]*,+/);
        if (commaMatch) {
            endIndex += commaMatch[0].length;
        }
    }

    const fullText = text.substring(startIndex, endIndex);
    const content = text.substring(contentStartIndex, contentEndIndex);

    return { header, content, fullText, startIndex, endIndex };
}

/**
 * Phase 1: Parses a .setting file and breaks it down into a linear list of segments.
 * @param {string} fileContent The entire string content of the .setting file.
 * @returns {{segments: Array<object>, diagnostics: object}}
 */
function parseFileIntoSegments(fileContent) {
    const diagnostics = {};
    const foundBlocks = [];

    const mainGroupRegex = /(?:\["([^"]+)"\]|(\w+))[\s\t]*=[\s\t]*(GroupOperator|MacroOperator)[\s\t]*{/;
    const mainGroupResult = findBlock(fileContent, mainGroupRegex);


    if (mainGroupResult) {
        const groupBodyOffset = mainGroupResult.startIndex + mainGroupResult.header.length;
        const groupBody = mainGroupResult.content;

        const inputsRegex = /[\s\t]*Inputs[\s\t]*=[\s\t]*ordered\(\)[\s\t]*{/;
        const inputsResult = findBlock(groupBody, inputsRegex, 0, true);
        if (inputsResult) {
            foundBlocks.push({
                type: 'inputs_block',
                startIndex: groupBodyOffset + inputsResult.startIndex,
                endIndex: groupBodyOffset + inputsResult.endIndex,
                content: inputsResult.content,
                fullText: inputsResult.fullText
            });
        }

        const toolsRegex = /[\s\t]*Tools[\s\t]*=[\s\t]*ordered\(\)[\s\t]*{/;
        const toolsResult = findBlock(groupBody, toolsRegex, 0, true);
        if (toolsResult) {
            const toolsBodyOffset = toolsResult.startIndex + toolsResult.header.length;
            const toolsBody = toolsResult.content;

            const helperRegex = /[\s\t]*background_helper[\s\t]*=[\s\t]*Background[\s\t]*{/;
            const helperResult = findBlock(toolsBody, helperRegex, 0, true);
            if (helperResult) {
                foundBlocks.push({
                    type: 'helper_block',
                    startIndex: groupBodyOffset + toolsBodyOffset + helperResult.startIndex,
                    endIndex: groupBodyOffset + toolsBodyOffset + helperResult.endIndex,
                    content: helperResult.content,
                    fullText: helperResult.fullText
                });
            } else {
                const firstNewlineInTools = toolsBody.indexOf('\n');
                const insertionOffset = (firstNewlineInTools !== -1) ? firstNewlineInTools + 1 : 0;
                const insertionIndex = groupBodyOffset + toolsBodyOffset + insertionOffset;
                foundBlocks.push({
                    type: 'helper_block',
                    startIndex: insertionIndex,
                    endIndex: insertionIndex,
                    content: '',
                    fullText: ''
                });
            }
        }
    }

    foundBlocks.sort((a, b) => a.startIndex - b.startIndex);
    const segments = [];
    let currentIndex = 0;
    for (const block of foundBlocks) {
        if (block.startIndex > currentIndex) {
            segments.push({ type: 'string', content: fileContent.substring(currentIndex, block.startIndex) });
        }
        segments.push({ type: block.type, content: block.content, fullText: block.fullText });
        currentIndex = block.endIndex;
    }
    if (currentIndex < fileContent.length) {
        segments.push({ type: 'string', content: fileContent.substring(currentIndex) });
    }

    return { segments, diagnostics };
}


/**
 * Phase 2: Builds the hierarchical tree from the content of the input and helper blocks.
 * @param {string} inputsBlockContent The content of the 'Inputs' block.
 * @param {string} helperBlockContent The content of the 'background_helper' block.
 * @param {object} diagnostics A reference to the diagnostics object to populate.
 * @returns {{tree: object, maxAutoLabelIndex: number}}
 */
function buildTreeFromContent(inputsBlockContent, helperBlockContent, diagnostics) {
    let nextId = 0;
    const root = { id: nextId++, type: 'ROOT', children: [], parent: null };

    // --- Pass 1: Create a flat list of all InstanceInputs and Page Comments from the inputs_block ---
    const flatList = [];
    if (inputsBlockContent) {
        diagnostics.inputsBlockSnippet = inputsBlockContent.trim().substring(0, 200) + '...';
        let currentPageName = "Controls";

        const instanceInputRegex = /([a-zA-Z0-9_]+)[\s\t]*=[\s\t]*InstanceInput[\s\t]*{([^}]*)}/g;
        let match;
        const allControlData = [];

        // Extract full block text for each input
        const rawInputs = inputsBlockContent.split(/([a-zA-Z0-9_]+[\s\t]*=[\s\t]*InstanceInput[\s\t]*{)/).slice(1);
        for (let i = 0; i < rawInputs.length; i += 2) {
            const header = rawInputs[i];
            const key = header.match(/([a-zA-Z0-9_]+)/)[0];
            const bodySearch = rawInputs[i+1];

            let braceDepth = 1;
            let endIndex = -1;
            for(let j=0; j<bodySearch.length; j++){
                if(bodySearch[j] === '{') braceDepth++;
                if(bodySearch[j] === '}') braceDepth--;
                if(braceDepth === 0){
                    endIndex = j;
                    break;
                }
            }
            if(endIndex === -1) continue;

            const content = bodySearch.substring(0, endIndex);
            const fullOriginalBlock = header + content + '}';
            const properties = {};
            const propsRegex = /(\w+)[\s\t]*=[\s\t]*(?:"([^"]*)"|({[^}]*})|([^,}[\s\t]]+))/g;
            let propMatch;
            while ((propMatch = propsRegex.exec(content)) !== null) {
                properties[propMatch[1]] = propMatch[2] || propMatch[3] || propMatch[4];
            }

            if (properties.Source === 'Separator') {
                allControlData.push({ type: 'SEPARATOR_DATA', key, properties, originalBlock: fullOriginalBlock });
            } else {
                allControlData.push({ type: 'CONTROL_DATA', key, properties, originalBlock: fullOriginalBlock });
            }
        }


        let firstControl = true;
        for (const item of allControlData) {
            const pageProperty = item.properties.Page;
            if (firstControl) {
                if (pageProperty && pageProperty !== "Controls") {
                    currentPageName = pageProperty;
                    flatList.push({ type: 'PAGE_MARKER', name: currentPageName });
                }
                firstControl = false;
            } else {
                if (pageProperty && pageProperty !== currentPageName) {
                    flatList.push({ type: 'PAGE_MARKER', name: pageProperty });
                    currentPageName = pageProperty;
                }
            }
            if (item.properties.Page) {
                delete item.properties.Page;
            }
            flatList.push(item);
        }
    }


    // --- Pass 2: Read the helper node metadata from the helper_block ---
    const metadataMap = new Map();
    let maxAutoLabelIndex = 0;
    if (helperBlockContent) {
        diagnostics.helperBlockSnippet = helperBlockContent.trim().substring(0, 200) + '...';
        const userControlsBlock = findBlock(helperBlockContent, /UserControls[\s\t]*=[\s\t]*ordered\(\)[\s\t]*{/);
        if (userControlsBlock) {
            const controlRegex = /(AutoLabel\d+)[\s\t]*=[\s\t]*{([^}]+)}/g;
            let controlMatch;
            while ((controlMatch = controlRegex.exec(userControlsBlock.content)) !== null) {
                const key = controlMatch[1];
                const numCap = key.match(/AutoLabel(\d+)/);
                if (numCap) {
                    maxAutoLabelIndex = Math.max(maxAutoLabelIndex, parseInt(numCap[1], 10));
                }
                const propertiesText = controlMatch[2];
                const nameMatch = propertiesText.match(/LINKS_Name[\s\t]*=[\s\t]*"([^"]+)"/);
                const nestLevelMatch = propertiesText.match(/LBLC_NestLevel[\s\t]*=[\s\t]*(\d+)/);
                const numInputsMatch = propertiesText.match(/LBLC_NumInputs[\s\t]*=[\s\t]*(\d+)/);

                if (nameMatch && nestLevelMatch && numInputsMatch) {
                    metadataMap.set(key, {
                        name: nameMatch[1],
                        nestLevel: parseInt(nestLevelMatch[1], 10),
                        childCount: parseInt(numInputsMatch[1], 10)
                    });
                }
            }
        }
    }

    // --- Pass 3: Reconstruct the tree using a recursive function ---
    function buildTreeRecursive(parent, items) {
        while (items.length > 0) {
            const item = items.shift();
            if (item.type === 'PAGE_MARKER') {
                const pageNode = { id: nextId++, type: 'PAGE', name: item.name, parent: root, children: [] };
                root.children.push(pageNode);
                continue;
            }
            if (item.type === 'SEPARATOR_DATA') {
                parent.children.push({
                    id: nextId++, type: 'SEPARATOR',
                    data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties },
                    parent: parent, children: [], hidden: false
                });
                continue;
            }
            if (item.type === 'CONTROL_DATA') {
                const isGroup = metadataMap.has(item.properties.Source);
                if (isGroup) {
                    const metadata = metadataMap.get(item.properties.Source);
                    const groupNode = {
                        id: nextId++, type: 'GROUP', name: metadata.name,
                        internalKey: item.properties.Source, parent: parent, children: [],
                        data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties }
                    };
                    parent.children.push(groupNode);
                    buildTreeRecursive(groupNode, items.splice(0, metadata.childCount));
                } else {
                    parent.children.push({
                        id: nextId++, type: 'CONTROL',
                        data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties },
                        parent: parent, children: [], hidden: /^MainInput\d+$/i.test(item.key)
                    });
                }
            }
        }
    }

    buildTreeRecursive(root, flatList);

    return { tree: root, maxAutoLabelIndex };
}


/**
 * Main parser function.
 * @param {string} content The string content of the .setting file.
 * @returns {{tree: object, segments: Array<object>, maxAutoLabelIndex: number, diagnostics: object}}
 */
export function parseSettingFile(content) {
    // Phase 1: Split file into structural segments
    const { segments, diagnostics } = parseFileIntoSegments(content);

    // Extract the content of our target blocks
    const inputsSegment = segments.find(s => s.type === 'inputs_block');
    const helperSegment = segments.find(s => s.type === 'helper_block');
    const inputsBlockContent = inputsSegment ? inputsSegment.content : '';
    const helperBlockContent = helperSegment ? helperSegment.content : '';

    // Phase 2: Build the UI tree from the extracted content
    const { tree, maxAutoLabelIndex } = buildTreeFromContent(inputsBlockContent, helperBlockContent, diagnostics);

    return {
        tree,
        segments,
        maxAutoLabelIndex,
        diagnostics
    };
}
