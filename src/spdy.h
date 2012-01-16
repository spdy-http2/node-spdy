namespace spdy {
  inline uint16_t readUInt16(const uint8_t* data) {
    return (data[0] << 8) + data[1];
  }

  inline uint32_t readUInt24(const uint8_t* data) {
    return (data[0] << 16) + (data[1] << 8) + data[2];
  }

  inline uint32_t readUInt32(const uint8_t* data) {
    return (data[0] << 24) + (data[1] << 16) + (data[2] << 8) + data[3];
  }
}
