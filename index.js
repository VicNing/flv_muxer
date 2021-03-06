const fs = require('fs');
const path = require('path');
const Buffer = require('buffer').Buffer;
const {errInvalidFrame, errInvalidBit} = require('./exception');

const PRIMITIVE_TYPE = {
    UBIT: 'ubit',
    UINT8: 'uint8',
    UINT24: 'uint24',
    UINT32: 'uint32',
};

const DATA_TYPE = {
    BITS: 'bits',
    FLVTAG: 'flvtag',
    AUDIODATA: 'audiodata',
    VIDEODATA: 'videodata',
    SCRIPTDATA: 'scriptDat',
    SCRIPTDATAOBJECT: 'scriptDataObject',
}

const HEADER_FIELD = {
    SIGNATURE: 'signature',
    VERSION: 'version',
    TYPE_FLAGS_RESERVED: 'typeFlagsReserved',
    TYPE_FLAGS_AUDIO: 'typeFlagsAudio',
    TYPE_FLAGS_VIDEO: 'typeFlagsVideo',
    DATA_OFFSET: 'dataOffset'
};

const HEADER_SPEC = {
    0: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x46,
        desc: 'it should always be \'F\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    1: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x4c,
        desc: 'it should always be \'L\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    2: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x56,
        desc: 'it should always be \'V\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    3: {
        field: HEADER_FIELD.VERSION,
        desc: 'it is the file version',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    4: {
        desc: 'it contains type flags',
        length: 1,
        type: DATA_TYPE.BITS,
        bits: {
            0: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'it must be 0',
                predicate: bits => (bits & 0b11111000) === 0,
                length: 5,
                type: PRIMITIVE_TYPE.UBIT
            },
            5: {
                field: HEADER_FIELD.TYPE_FLAGS_AUDIO,
                desc: 'it presents audio tags',
                // predicate: bits => bits & 0b00000100 === 1,
                length: 1,
                type: PRIMITIVE_TYPE.UBIT
            },
            6: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'it must be 0',
                predicate: bits => (bits & 0b00000010) === 0,
                length: 1,
                type: PRIMITIVE_TYPE.UBIT
            },
            7: {
                field: HEADER_FIELD.TYPE_FLAGS_VIDEO,
                desc: 'presents video tags',
                length: 1,
                type: PRIMITIVE_TYPE.UBIT
            }

        }
    },
    5: {
        field: HEADER_FIELD.DATA_OFFSET,
        desc: 'it shows offset in bytes',
        length: 1,
        type: PRIMITIVE_TYPE.UINT32
    }
};

const BODY_FIELD = {
    PREVIOUS_TAG_SIZE: 'previousTagSize',
    TAG: 'tag'
};

const BODY_SPEC = {
    0: {
        field: BODY_FIELD.PREVIOUS_TAG_SIZE,
        desc: (buffer, offset, [tagSize]) => `previous tag size is ${tagSize}`,
        eval: buffer => buffer.readUInt32BE(0),
        length: 1,
        type: PRIMITIVE_TYPE.UINT32,

    },
    1: {
        field: BODY_FIELD.TAG,
        length: undefined,
        type: DATA_TYPE.FLVTAG
    }
};

const TAG_FILED = {
    TAG_TYPE: 'tagType',
    DATA_SIZE: 'dataSize',
    TIMESTAMP: 'timestamp',
    TIMESTAMP_EXTENDED: 'timestampExtended',
    STREAM_ID: 'streamId',
    DATA: 'data'
};

const TAG_SPEC = {
    0: {
        field: TAG_FILED.TAG_TYPE,
        eval: buffer => {
            let integer = buffer.readUInt8(0);
            switch (integer) {
                case 8:
                    return DATA_TYPE.AUDIODATA
                case 9:
                    return DATA_TYPE.VIDEODATA
                case 18:
                    return DATA_TYPE.SCRIPTDATA
                default:
                    return null;
            }
        },
        desc: (buffer, offset) => {
            let integer = buffer.readUInt8(0);
            switch (integer) {
                case 8:
                    return `it's a audio tag `
                case 9:
                    return `it's a video tag `
                case 18:
                    return `it's a script data`
                default:
                    return 'reserved value'
            }
        },
        type: PRIMITIVE_TYPE.UINT8,
        length: 1
    },
    1: {
        field: TAG_FILED.DATA_SIZE,
        type: PRIMITIVE_TYPE.UINT24,
        length: 1,
        desc: (buffer, offset, [datasize]) => `length of the data in the data field is ${datasize} bytes`
    },
    4: {
        field: TAG_FILED.TIMESTAMP,
        type: PRIMITIVE_TYPE.UINT24,
        length: 1,
        eval: buffer => buffer.readUIntBE(0, 3)
    },
    7: {
        field: TAG_FILED.TIMESTAMP_EXTENDED,
        type: PRIMITIVE_TYPE.UINT8,
        length: 1,
        eval: (buffer, timestamp) => buffer.readUInt8(0) << 4 + timestamp,
        desc: (buffer, offset, [timestamp]) => `this tag applies to data at ${timestamp} ms`
    },
    8: {
        field: TAG_FILED.STREAM_ID,
        type: PRIMITIVE_TYPE.UINT24,
        predicate: buffer => {
            if (buffer.readUIntBE(0, 3) === 0) {
                return true;
            } else {
                throw new Error('predicate not passed!');
            }
        },
        desc: 'stream id always 0',
        length: 1
    },
    11: {
        field: TAG_FILED.DATA,
        type: undefined
    }
};

const SCRIPT_DATA_OBJECT_FIELD = {
    OBJECTS: 'objects',
    END: 'end'
};

const SCRIPT_DATA_OBJECT_SPEC = {
    0: {
        field: SCRIPT_DATA_OBJECT_FIELD.OBJECTS,
        type: DATA_TYPE.SCRIPTDATAOBJECT,
        length: undefined,
    },
    e: {
        field: SCRIPT_DATA_OBJECT_FIELD.END,
        type: PRIMITIVE_TYPE.UINT24,
        length: 1,
        predicate: buffer => {
            if (buffer.readUIntBE(0, 3) === 9) {
                return true
            } else {
                throw new Error('end of scriptDataObject must be 9!');
            }
        },
        desc: 'it\'s the end of scriptDataObject'
    }
}

const speak = function (frame, buffer, offset, ...rest) {
    if (frame.desc) {
        if (typeof frame.desc === 'string') {
            return frame.desc;
        } else if (typeof frame.desc === 'function') {
            return frame.desc(buffer, offset, rest);
        }
    }
}

const log = function (word) {
    if (typeof word === 'string') {
        console.log(word);
    }
}

const typeLength = function (type, length) {
    if (!type || !length) {
        throw new Error('invalid parameter type!');
    }
    let byteLength = 0;
    switch (type) {
        case PRIMITIVE_TYPE.UINT8:
            byteLength = 1;
            break;
        case PRIMITIVE_TYPE.UINT24:
            byteLength = 3;
            break;
        case PRIMITIVE_TYPE.UINT32:
            byteLength = 4;
            break;
        case PRIMITIVE_TYPE.UBYTE:
            byteLength = 1;
            break;
        case DATA_TYPE.SCRIPTDATAOBJECT:
            byteLength = 1;
            break;
        default:
            throw new Error(`typeLength doesn\'t have type ${type}`);
    }
    return byteLength * length;
}

const sliceByteChunk = function (chunk, offset, length, type) {
    let bufferLength = typeLength(type, length);
    let byteArray = [];
    for (let i = 0; i < bufferLength; i++) {
        byteArray.push(chunk[offset]);
        offset++;
    }
    return Buffer.from(byteArray);
}

const verifyBits = function (bits, spec, byteOffset, bitOffset) {
    if (bitOffset > 7) {
        return true;
    }

    let frame = spec[bitOffset];
    if (frame) {
        /*if (frame.predicate) {
            return frame.predicate(bits) ? describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, bitOffset + frame.length) : false;
        } else {
            return describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, bitOffset + frame.length);
        }*/
        frame.predicate && frame.predicate(bits);
        log(speak(frame, bits, byteOffset));
        verifyBits(bits, spec, byteOffset, bitOffset + frame.length);
    } else {
        throw errInvalidBit;
    }
}

const demuxFlvHeader = function (chunk, offset) {
    if (offset > 8) {
        return offset;
    }

    let frame = HEADER_SPEC[offset];
    /*if (frame) {
        if (frame.type === DATA_TYPE.BITS) {
            if (verifyBits(chunk[offset], frame.bits, offset, 0)) {
                return demuxFlvHeader(chunk, offset + 1);
            } else {
                throw new Error(`bits not verified at offset ${offset}`);
            }
        }
        else if (frame.predicate) {
            let buffer = sliceByteChunk(chunk, offset, frame.length, frame.type);
            if (frame.predicate(buffer)) {
                console.log(`it ${frame.desc} at offset ${offset}`);
                return demuxFlvHeader(chunk, offset + buffer.length);
            } else {
                throw new Error(`invalid header field at offset ${offset}, it ${frame.desc}`);
            }
        }
        else {
            console.log(`it ${frame.desc} at offset ${offset}`);
            return demuxFlvHeader(chunk, offset + typeLength(frame.type, frame.length));
        }
    } else {
        throw new Error(`header frame at ${offset} doesn\'t exist!`)
    }*/

    if (frame) {
        let buffer = null;
        if (frame.type === DATA_TYPE.BITS) {
            buffer = sliceByteChunk(chunk, offset, frame.length, PRIMITIVE_TYPE.UINT8);
            verifyBits(buffer.readUInt8(0), frame.bits, offset, 0);
        } else {
            buffer = sliceByteChunk(chunk, offset, frame.length, frame.type);
            frame.predicate && frame.predicate(buffer);
            log(speak(frame, buffer, offset));
        }
        return demuxFlvHeader(chunk, offset + buffer.length);
    } else {
        throw errInvalidFrame;
    }


}

const demuxFlvBody = function (chunk, offset, field, previousTagSize) {
    /* if (reachEOF) {
        return;
    } */

    if (field === BODY_FIELD.PREVIOUS_TAG_SIZE) {
        debugger
        let frame = BODY_SPEC[0];
        let buffer = sliceByteChunk(chunk, offset, frame.length, frame.type);
        let pTagSize = frame.eval(buffer);
        if (pTagSize !== previousTagSize) {
            throw new Error('Incorrect tag size!');
        }
        log(speak(frame, buffer, offset, pTagSize));
        demuxFlvBody(chunk, offset + buffer.length, BODY_FIELD.TAG);
    } else if (field === BODY_FIELD.TAG) {
        tagLength = demuxFlvTag()(chunk, offset, offset);
        demuxFlvBody(chunk, offset + tagLength, BODY_FIELD.PREVIOUS_TAG_SIZE, tagLength);
    }
}

const demuxFlvTag = function () {
    let dataType = null;
    let tagLength = null;
    let timestamp = 0;

    return function realDeal(chunk, offset, initOffset) {
        if (tagLength && (offset - initOffset) > tagLength) {
            return tagLength;
        }

        let frame = TAG_SPEC[offset - initOffset];
        if (frame) {
            if (frame.field === TAG_FILED.DATA && tagLength > 11) {
                demuxFlvTagData(chunk, offset, offset, dataType, tagLength - 11);
                return tagLength;
            }

            let buffer = sliceByteChunk(chunk, offset, frame.length, frame.type);

            frame.predicate && frame.predicate(buffer);

            switch (frame.field) {
                case TAG_FILED.TAG_TYPE:
                    dataType = frame.eval(buffer);
                    log(speak(frame, buffer, offset));
                    break;
                case TAG_FILED.DATA_SIZE:
                    let dataSize = buffer.readUIntBE(0, 3);
                    tagLength = 11 + dataSize;
                    log(speak(frame, buffer, offset, dataSize));
                    break;
                case TAG_FILED.TIMESTAMP:
                    timestamp = frame.eval(buffer);
                    break;
                case TAG_FILED.TIMESTAMP_EXTENDED:
                    timestamp = frame.eval(buffer, timestamp);
                    log(speak(frame, buffer, offset, timestamp));
                    break;
                default:
                    log(speak(frame, buffer, offset));
                    break;
            }

            return realDeal(chunk, offset + buffer.length, initOffset);
        } else {
            throw new Error(`frame at ${offset} doesn\'t exist!`)
        }
    }
};

const demuxFlvTagData = function (chunk, offset, initOffset, dataType, dataSize) {
    switch (dataType) {
        case DATA_TYPE.AUDIODATA:
            demuxFlvAudioData(chunk, offset, initOffset, dataSize);
            break;
        case DATA_TYPE.VIDEODATA:
            demuxFlvVideoData(chunk, offset, initOffset, dataSize);
            break;
        case DATA_TYPE.SCRIPTDATA:
            demuxFlvScriptData(chunk, offset, initOffset, dataSize);
            break;
        default:
            throw new Error('invalid tag data type!');
    }
};

const demuxFlvAudioData = function (chunk, offset, initOffset, dataSize) {
    console.log('demux audio data');
}

const demuxFlvVideoData = function (chunk, offset, initOffset, dataSize) {
    console.log('demux video data');
}

const demuxFlvScriptData = function (chunk, offset, initOffset, dataSize) {
    if (offset - initOffset >= dataSize) {
        return null;
    }

    let frame = null;
    if (offset - initOffset === 0) {
        frame = Object.assign({}, SCRIPT_DATA_OBJECT_SPEC[0]);
        frame.length = dataSize - 3;//3bytes for END field
    } else {
        frame = SCRIPT_DATA_OBJECT_SPEC['e'];
    }

    let buffer = sliceByteChunk(chunk, offset, frame.length, frame.type);
    frame.predicate && frame.predicate(buffer);
    log(speak(frame, buffer, offset));
    return demuxFlvScriptData(chunk, offset + buffer.length, initOffset, dataSize);
};

const readStream = function () {
    let offset = 0,
        chunkPosition = 0;
    return function (chunk) {
        if (chunkPosition === 0) {
            offset = demuxFlvHeader(chunk, offset);
            offset = demuxFlvBody(chunk, offset, BODY_FIELD.PREVIOUS_TAG_SIZE, 0);
        } else {

        }
        chunkPosition += chunk.length
    }
}

let stream = fs.createReadStream(path.resolve(__dirname, 'videos', 'sample.flv'))

stream.on('data', readStream())
stream.on('error', err => {
    throw err
})


