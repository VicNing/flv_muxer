const fs = require('fs');
const path = require('path');
const Buffer = require('buffer').Buffer;

const HEADER_FIELD = {
    SIGNATURE: 'signature',
    VERSION: 'version',
    TYPE_FLAGS_RESERVED: 'typeFlagsReserved',
    TYPE_FLAGS_AUDIO: 'typeFlagsAudio',
    TYPE_FLAGS_VIDEO: 'typeFlagsVideo',
    DATA_OFFSET: 'dataOffset'
};

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

const HEADER_SPEC = {
    0: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x46,
        desc: 'should always be \'F\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    1: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x4c,
        desc: 'should always be \'L\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    2: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x56,
        desc: 'should always be \'V\'',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    3: {
        field: HEADER_FIELD.VERSION,
        desc: 'is file version',
        length: 1,
        type: PRIMITIVE_TYPE.UINT8
    },
    4: {
        desc: 'contains type flags',
        length: 1,
        type: DATA_TYPE.BITS,
        bits: {
            0: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'must be 0',
                predicate: bits => (bits & 0b11111000) === 0,
                length: 5,
                type: PRIMITIVE_TYPE.UBIT
            },
            5: {
                field: HEADER_FIELD.TYPE_FLAGS_AUDIO,
                desc: 'presents audio tags',
                // predicate: bits => bits & 0b00000100 === 1,
                length: 1,
                type: PRIMITIVE_TYPE.UBIT
            },
            6: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'must be 0',
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
        desc: 'shows offset in bytes',
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
        desc: buf => `previous tag size is ${buf.buffer.readUInt32BE(0)}`,
        length: 1,
        type: PRIMITIVE_TYPE.UINT32,

    },
    1: {
        field: BODY_FIELD.TAG,
        desc: '',
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
        eval: buf => {
            let integer = buf.buffer.readUInt8(0);
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
        desc: (buf, offset) => {
            let integer = buf.buffer.readUInt8(0);
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
        desc: (buf, offset, [datasize]) => `length of the data in the data field is ${datasize} bytes`
    },
    4: {
        field: TAG_FILED.TIMESTAMP,
        type: PRIMITIVE_TYPE.UINT24,
        length: 1,
        eval: buf => buf.buffer.readUIntBE(0, 3)
    },
    7: {
        field: TAG_FILED.TIMESTAMP_EXTENDED,
        type: PRIMITIVE_TYPE.UINT8,
        length: 1,
        eval: (buf, timestamp) => buf.buffer.readUInt8(0) << 4 + timestamp,
        desc: (buf, offset, [timestamp]) => `this tag applies to data at ${timestamp} ms`
    },
    8: {
        field: TAG_FILED.STREAM_ID,
        type: PRIMITIVE_TYPE.UINT24,
        predicate: buf => {
            if (buf.buffer.readUIntBE(0, 3) === 0) {
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
        predicate: buf => {
            if (buf.buffer.readUIntBE(0, 3) === 9) {
                return true
            } else {
                throw new Error('end of scriptDataObject must be 9!');
            }
        },
        desc: 'it\'s the end of scriptDataObject'
    }
}

const describe = function (frame, offset, bit) {
    let describe = `it ${frame.desc} ${typeof bit === 'number' ? `in bit ${bit}` : ''} at offset ${offset}`;
    console.log(describe);
    return describe;
}

const speak = function (frame, buf, offset, ...rest) {
    if (frame.desc) {
        if (typeof frame.desc === 'string') {
            return frame.desc;
        } else if (typeof frame.desc === 'function') {
            return frame.desc(buf, offset, rest);
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
        if (frame.predicate) {
            return frame.predicate(bits) ? describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, bitOffset + frame.length) : false;
        } else {
            return describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, bitOffset + frame.length);
        }
    } else {
        return false;
    }
}

const demuxFlvHeader = function (chunk, offset) {
    if (offset > 8) {
        return offset;
    }

    let frame = HEADER_SPEC[offset];
    if (frame) {
        if (frame.type === DATA_TYPE.BITS) {
            if (verifyBits(chunk[offset], frame.bits, offset, 0)) {
                return demuxFlvHeader(chunk, offset + 1);
            } else {
                throw new Error(`bits not verified at offset ${offset}`);
            }
        }
        else if (frame.predicate) {
            let sliceBundle = sliceByteChunk(chunk, offset, frame.length, frame.type);
            if (frame.predicate(sliceBundle.buffer)) {
                console.log(`it ${frame.desc} at offset ${offset}`);
                return demuxFlvHeader(chunk, offset + sliceBundle.bufferLength);
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
    }


}

const demuxFLvBody = function (chunk, offset, field) {
    /* if (reachEOF) {
        return;
    } */

    if (field === BODY_FIELD.PREVIOUS_TAG_SIZE) {
        let frame = BODY_SPEC[0];
        let buf = sliceByteChunk(chunk, offset, frame.length, frame.type);
        log(speak(frame, buf, offset));
        demuxFLvBody(chunk, offset + buf.bufferLength, BODY_FIELD.TAG);
    } else if (field === BODY_FIELD.TAG) {
        tagLength = demuxFlvTag()(chunk, offset, 0);
        // demuxFLvBody(chunk, offset + tagLength, BODY_FIELD.PREVIOUS_TAG_SIZE);
    }
}

const demuxFlvTagData = function (chunk, chunkOffset, offset, dataType, dataSize) {
    switch (dataType) {
        case DATA_TYPE.AUDIODATA:
            break;
        case DATA_TYPE.VIDEODATA:
            break;
        case DATA_TYPE.SCRIPTDATA:
            demuxFlvScriptData(chunk, chunkOffset, offset, dataSize);
            break;
        default:
            throw new Error('invalid tag data type!');
    }
};

const demuxFlvScriptData = function (chunk, chunkOffset, offset, dataSize) {
    if (offset >= dataSize) {
        return null;
    }

    let frame = null;
    if (offset === 0) {
        frame = Object.assign({}, SCRIPT_DATA_OBJECT_SPEC[0]);
        frame.length = dataSize - 3;//3bytes for END field
    } else {
        frame = SCRIPT_DATA_OBJECT_SPEC['e'];
    }

    let buf = sliceByteChunk(chunk, chunkOffset + offset, frame.length, frame.type);
    frame.predicate && frame.predicate(buf);
    log(speak(frame, buf, offset));
    return demuxFlvScriptData(chunk, chunkOffset, offset + buf.bufferLength, dataSize);
};

const demuxFlvTag = function () {
    let dataType = null;
    let tagLength = null;
    let timestamp = 0;

    return function realDeal(chunk, chunkOffset, offset) {
        if (tagLength && offset > tagLength) {
            return tagLength;
        }

        let frame = TAG_SPEC[offset];
        if (frame) {
            if (frame.field === TAG_FILED.DATA && tagLength > 11) {
                demuxFlvTagData(chunk, chunkOffset + offset, 0, dataType, tagLength - 11);
                return tagLength;
            }

            let buf = sliceByteChunk(chunk, chunkOffset + offset, frame.length, frame.type);

            frame.predicate && frame.predicate(buf);

            switch (frame.field) {
                case TAG_FILED.TAG_TYPE:
                    dataType = frame.eval(buf);
                    log(speak(frame, buf, offset));
                    break;
                case TAG_FILED.DATA_SIZE:
                    let dataSize = buf.buffer.readUIntBE(0, 3);
                    tagLength = 11 + dataSize;
                    log(speak(frame, buf, offset, dataSize));
                    break;
                case TAG_FILED.TIMESTAMP:
                    timestamp = frame.eval(buf);
                    break;
                case TAG_FILED.TIMESTAMP_EXTENDED:
                    timestamp = frame.eval(buf, timestamp);
                    log(speak(frame, buf, chunkOffset, timestamp));
                    break;
                default:
                    log(speak(frame.desc, buf.buffer));
                    break;
            }

            return realDeal(chunk, chunkOffset, offset + buf.bufferLength);
        } else {
            throw new Error(`frame at ${chunkOffset + offset} doesn\'t exist!`)
        }
    }
};

const readStream = function () {
    let offset = 0,
        chunkPosition = 0;
    return function (chunk) {
        if (chunkPosition === 0) {
            offset = demuxFlvHeader(chunk, offset);
            offset = demuxFLvBody(chunk, offset, BODY_FIELD.PREVIOUS_TAG_SIZE);
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


