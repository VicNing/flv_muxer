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
    FLVTAG: 'flvtag'
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
        desc: '',
        length: 1,
        type: PRIMITIVE_TYPE.UINT32
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
        desc: function (value) {
            switch (value) {
                case 8:
                    break;
                case 9:
                    break;
                case 10:
                    break;
                default:
                    break;
            }
        },
        type: PRIMITIVE_TYPE.UINT8,
        length: 1
    },
    1: {
        field: TAG_FILED.DATA_SIZE,
        type: PRIMITIVE_TYPE.UINT24,
        length: 1
    },
    4: {
        field: TAG_FILED.TIMESTAMP,
        type: PRIMITIVE_TYPE.UINT24
    },
    7: {
        field: TAG_FILED.TIMESTAMP_EXTENDED,
        type: PRIMITIVE_TYPE.UINT8
    },
    8: {
        field: TAG_FILED.STREAM_ID,
        type: PRIMITIVE_TYPE.UINT24
    },
    11: {
        field: TAG_FILED.DATA,
        type: undefined
    }
};

const describe = function (frame, offset, bit) {
    let describe = `it ${frame.desc} ${typeof bit === 'number' ? `in bit ${bit}` : ''} at offset ${offset}`;
    console.log(describe);
    return describe;
}

const typeLength = function (type, length) {
    let byteLength = 0;
    switch (type) {
        case PRIMITIVE_TYPE.UINT8:
            byteLength = 1;
            break;
        case PRIMITIVE_TYPE.UINT32:
            byteLength = 4;
            break;
        case PRIMITIVE_TYPE.UBYTE:
            byteLength = 1;
            break;
        default:
            throw new Error(`typeLength doesn\'t have type ${type}`);
    }
    let totalLength = byteLength * length;
    return totalLength;
}

const sliceByteChunk = function (chunk, offset, length, type) {
    let totalLength = typeLength(type, length);
    let byteArray = [];
    for (let i = 0; i < totalLength; i++) {
        byteArray.push(chunk[offset]);
        offset++;
    }
    let slice = Buffer.from(byteArray);
    return { slice, totalLength };
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
            if (frame.predicate(sliceBundle.slice)) {
                console.log(`it ${frame.desc} at offset ${offset}`);
                return demuxFlvHeader(chunk, offset + sliceBundle.totalLength);
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
        let sliceBundle = sliceByteChunk(chunk, offset, frame.length, frame.type);
        let previousTagSize = sliceBundle.slice.readUInt32BE(0);
        console.log(`previous tag size is ${previousTagSize}`);
        demuxFLvBody(chunk, offset + sliceBundle.length, BODY_FIELD.TAG);
    } else if (filed === BODY_FIELD.TAG) {
        tagLength = demuxFlvTag(chunk, offset, 0);
        demuxFLvBody(chunk, offset + tagLength, BODY_FIELD.PREVIOUS_TAG_SIZE);
    }
}

const demuxFlvTag = function (chunk, offset, position) {
    let frame = TAG_SPEC[position];
    if (frame) {

    } else {

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
stream.on('error', err => { throw err })


